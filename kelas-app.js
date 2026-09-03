'use strict';

(() => {
  const portal = window.CLASS_PORTAL;
  if (!portal) return;

  const page = document.body?.dataset.page;
  const config = window.SUPABASE_CONFIG;
  const supabaseClient = window.supabase?.createClient && config?.url && config?.publishableKey
    ? window.supabase.createClient(config.url, config.publishableKey)
    : null;
  const courses = portal.courses || [];
  let currentStudentProfile = null;

  const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[char]));

  const getCourse = id => courses.find(course => course.id === id) || courses[0];
  const getTask = (course, taskId) => course?.tasks.find(task => task.id === taskId);
  const taskStatusKey = task => `task-status-${task.id}`;
  const getTaskStatus = task => localStorage.getItem(taskStatusKey(task)) || 'Belum dikerjakan';
  const setTaskStatus = (task, status) => localStorage.setItem(taskStatusKey(task), status);
  const normalizePersonName = value => String(value || '').toLocaleLowerCase('id-ID').replace(/[^a-z0-9]+/g, ' ').trim();

  function isTaskVisibleToCurrentStudent(course, task) {
    // Normalisasi tipe agar variasi huruf besar/spasi dari database tidak dianggap tugas individu.
    const taskType = String(task.type || '').trim().toLowerCase();
    // Tugas individu berlaku untuk semua mahasiswa yang sedang login.
    if (taskType === 'individu') return true;
    // Selain tugas individu, perlakukan sebagai tugas kelompok dan tampilkan hanya untuk anggota kelompoknya.
    if (taskType !== 'kelompok') return false;
    if (!currentStudentProfile || !task.groupId) return false;
    const group = getTaskGroup(course, task);
    if (!group) return false;
    return group.members.some(member =>
      member.studentId === currentStudentProfile.user_id ||
      (!member.studentId && normalizePersonName(member.name) === normalizePersonName(currentStudentProfile.full_name))
    );
  }

  const getVisibleTasks = course => (course.tasks || []).filter(task => isTaskVisibleToCurrentStudent(course, task));

  function showAnnouncement(announcement) {
    document.getElementById('siteAnnouncement')?.remove();
    if (!announcement) return;
    if (announcement.maintenance_enabled) {
      const gate = document.createElement('div');
      gate.id = 'siteAnnouncement';
      gate.className = 'maintenance-overlay';
      gate.innerHTML = `<section class="maintenance-card"><span class="eyebrow">PEMBERITAHUAN</span><h1>Website sedang maintenance</h1><p>${escapeHTML(announcement.maintenance_message)}</p><small>Silakan kembali beberapa saat lagi.</small></section>`;
      document.body.appendChild(gate);
      return;
    }
    if (announcement.task_update_enabled && page === 'tasks') {
      const banner = document.createElement('section');
      banner.id = 'siteAnnouncement'; banner.className = 'task-update-card';
      banner.innerHTML = `<div class="task-update-card-icon">📣</div><div><span class="eyebrow">INFORMASI TUGAS</span><h2>Pengelola sedang menambahkan tugas</h2><p>${escapeHTML(announcement.task_update_message)}</p></div>`;
      document.querySelector('.page')?.prepend(banner);
    }
  }

  async function loadAnnouncement() {
    if (!supabaseClient) return;
    const { data } = await supabaseClient.from('site_announcements').select('*').eq('id', 1).maybeSingle();
    showAnnouncement(data);
  }

  function showNewTaskCard(tasks, courseById) {
    if (page !== 'tasks' || !tasks?.length) return;
    const recent = tasks.filter(task => {
      const created = new Date(task.created_at || task.updated_at || 0);
      return !Number.isNaN(created.getTime()) && (Date.now() - created.getTime()) < 14 * 24 * 60 * 60 * 1000;
    }).sort((a, b) => new Date(b.created_at || b.updated_at) - new Date(a.created_at || a.updated_at)).slice(0, 3);
    if (!recent.length) return;
    const card = document.createElement('section'); card.id = 'newTaskNotice'; card.className = 'new-task-card';
    card.innerHTML = `<div class="new-task-card-icon">✨</div><div><span class="eyebrow">TUGAS BARU</span><h2>Ada tugas baru</h2><p>${recent.map(task => `<strong>${escapeHTML(task.title)}</strong> · ${escapeHTML(courseById.get(task.course_id) || 'Mata kuliah')}`).join('<br>')}</p></div><button type="button" class="new-task-dismiss" aria-label="Tutup notifikasi">×</button>`;
    card.querySelector('.new-task-dismiss').addEventListener('click', () => card.remove());
    document.querySelector('.page')?.prepend(card);
  }

  function normalizeTask(task) {
    return {
      id: task.id,
      type: task.type,
      title: task.title,
      due: task.due_at,
      meeting: task.meeting || null,
      description: task.description || '',
      checklist: Array.isArray(task.checklist) ? task.checklist : [],
      submission: task.submission || '',
      attachmentName: task.attachment_name,
      attachmentUrl: task.attachment_url,
      groupId: task.group_id || null,
    };
  }

  async function loadPortalData() {
    if (!supabaseClient) return;
    const [{ data: remoteCourses, error: coursesError }, { data: remoteTasks, error: tasksError }] = await Promise.all([
      supabaseClient.from('courses').select('id, name, whatsapp_url'),
      supabaseClient.from('tasks').select('*').order('due_at', { ascending: true }),
    ]);
    if (coursesError || tasksError) return;

    const remoteCourseById = new Map(remoteCourses.map(course => [course.id, course]));
    const tasksByCourse = new Map();
    remoteTasks.forEach(task => {
      const tasks = tasksByCourse.get(task.course_id) || [];
      tasks.push(normalizeTask(task));
      tasksByCourse.set(task.course_id, tasks);
    });
    courses.forEach(course => {
      const remoteCourse = remoteCourseById.get(course.id);
      if (remoteCourse) {
        course.name = remoteCourse.name;
        course.groupLink.url = remoteCourse.whatsapp_url || course.groupLink.url;
      }
      course.tasks = tasksByCourse.get(course.id) || [];
    });

    const { data: remoteGroups, error: groupsError } = await supabaseClient
      .from('groups')
.select('id, course_id, name, group_members(name, student_id)')
      .order('name', { ascending: true });
    if (groupsError) return;

    const groupsByCourse = new Map();
    remoteGroups.forEach(group => {
      const groups = groupsByCourse.get(group.course_id) || [];
      groups.push({
        id: group.id,
        name: group.name,
        members: (group.group_members || []).map(member => ({ name: member.name, studentId: member.student_id || null })),
      });
      groupsByCourse.set(group.course_id, groups);
    });
    courses.forEach(course => {
      course.groups = groupsByCourse.get(course.id) || [];
    });
    const visibleRemoteTasks = remoteTasks.filter(remoteTask => {
      const course = courses.find(item => item.id === remoteTask.course_id);
      const task = course?.tasks?.find(item => item.id === remoteTask.id);
      return course && task && isTaskVisibleToCurrentStudent(course, task);
    });
    showNewTaskCard(visibleRemoteTasks, new Map(remoteCourses.map(course => [course.id, course.name])));
  }

  const getTaskGroup = (course, task) => course?.groups?.find(group => group.id === task.groupId) || null;

  function formatDate(value, short = false) {
    const date = new Date(value);
    return date.toLocaleDateString('id-ID', short
      ? { day: '2-digit', month: 'short' }
      : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function getMeetingDeadline(course, meeting) {
    const schedule = course?.classSchedule;
    if (!schedule || !portal.semesterStart || !Number.isInteger(Number(meeting))) return null;
    const semesterStart = new Date(`${portal.semesterStart}T00:00:00`);
    if (Number.isNaN(semesterStart.getTime())) return null;
    const deadline = new Date(semesterStart);
    deadline.setDate(semesterStart.getDate() + ((schedule.weekday - semesterStart.getDay() + 7) % 7) + ((Number(meeting) - 1) * 7));
    const [hours, minutes] = schedule.start.split(':').map(Number);
    deadline.setHours(hours, minutes, 0, 0);
    return deadline.toISOString();
  }

  function getTaskDeadline(course, task) {
    return task.due || (task.type === 'kelompok' ? getMeetingDeadline(course, task.meeting) : null);
  }

  function taskScheduleLabel(course, task, short = false) {
    const deadline = getTaskDeadline(course, task);
    if (task.type === 'kelompok' && task.meeting) {
      if (!deadline) return short ? `P-${task.meeting}` : `Pertemuan ke-${task.meeting}`;
      return short ? formatDate(deadline, true) : `Pertemuan ke-${task.meeting} · Deadline ${formatDate(deadline)}`;
    }
    return short ? formatDate(deadline, true) : `Deadline ${formatDate(deadline)}`;
  }

  function googleCalendarHref(course, task) {
    const deadline = getTaskDeadline(course, task);
    if (!deadline) return '';
    const start = new Date(deadline);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const calendarDate = value => value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const title = `${task.title} · ${course.name}`;
    const details = `${task.description || 'Deadline tugas.'}\nPengumpulan: ${task.submission || '-'}`;
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${calendarDate(start)}/${calendarDate(end)}&details=${encodeURIComponent(details)}`;
  }

  function setupBrowserReminder(allTasks) {
    const oldPanel = document.getElementById('browserReminder');
    if (oldPanel) oldPanel.remove();
    const panel = document.createElement('section');
    panel.id = 'browserReminder';
    panel.className = 'browser-reminder';
    const supported = 'Notification' in window;
    const permission = supported ? Notification.permission : 'unsupported';
    panel.innerHTML = `<div><strong>🔔 Pengingat browser</strong><span>${supported ? (permission === 'granted' ? 'Notifikasi browser sudah aktif.' : 'Aktifkan agar pengingat deadline muncul saat membuka portal.') : 'Browser ini belum mendukung notifikasi.'}</span></div>${supported && permission !== 'granted' ? '<button class="button button-secondary" type="button">Aktifkan notifikasi</button>' : ''}`;
    document.querySelector('.stats-grid')?.insertAdjacentElement('afterend', panel);
    const button = panel.querySelector('button');
    if (!button) return;
    button.addEventListener('click', async () => {
      const result = await Notification.requestPermission();
      if (result !== 'granted') { panel.querySelector('span').textContent = 'Izin notifikasi belum diberikan.'; return; }
      panel.querySelector('span').textContent = 'Notifikasi browser sudah aktif.';
      button.remove();
      const nearest = allTasks.map(({ course, task }) => ({ course, task, deadline: getTaskDeadline(course, task) })).filter(item => item.deadline && new Date(item.deadline) > new Date()).sort((a, b) => new Date(a.deadline) - new Date(b.deadline))[0];
      if (nearest) new Notification('PGSD HERO CLASS', { body: `Deadline terdekat: ${nearest.task.title} · ${formatDate(nearest.deadline)}` });
    });
  }

  function courseOptions(selectedId) {
    return courses.map(course => `<option value="${escapeHTML(course.id)}" ${course.id === selectedId ? 'selected' : ''}>${escapeHTML(course.name)}</option>`).join('');
  }

  function groupHref(course, task, group) {
    const query = new URLSearchParams({ matkul: course.id, tugas: task.id, kelompok: group.id });
    return `kelas-kelompok.html?${query.toString()}`;
  }

  function statusClass(status) {
    if (status === 'Sudah dikumpulkan') return 'status-selesai';
    if (status === 'Sedang dikerjakan') return 'status-berjalan';
    return 'status-belum';
  }

  function setupNavigation() {
    document.querySelectorAll('.main-nav a').forEach(link => {
      if (link.dataset.nav === page) link.setAttribute('aria-current', 'page');
    });
  }

  function setupThemeToggle() {
    if (document.querySelector('[data-theme-toggle]')) return;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'theme-toggle'; button.dataset.themeToggle = '1'; button.textContent = localStorage.getItem('theme') === 'dark' ? '☀️' : '🌙'; button.title = 'Ganti tema';
    document.querySelector('.main-nav')?.appendChild(button);
    if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-mode');
    button.addEventListener('click', () => { const dark = document.body.classList.toggle('dark-mode'); localStorage.setItem('theme', dark ? 'dark' : 'light'); button.textContent = dark ? '☀️' : '🌙'; });
  }

  function studentLoginHref(reason = '') {
    const fileName = window.location.pathname.split('/').pop() || 'kelas-tugas.html';
    const query = new URLSearchParams({ next: `${fileName}${window.location.search}` });
    if (reason) query.set('reason', reason);
    return `kelas-mahasiswa.html?${query.toString()}`;
  }

  async function updateStudentNavigation() {
    const link = document.querySelector('.main-nav a[data-nav="student"]');
    if (!link || !supabaseClient) return;
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      link.textContent = 'Masuk';
      link.href = 'kelas-mahasiswa.html';
      return;
    }
    const { data: profile } = await supabaseClient
      .from('student_profiles')
.select('user_id, nim, full_name')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (profile) {
      link.textContent = 'Akun Saya';
      link.href = 'kelas-mahasiswa.html';
      return;
    }
    link.textContent = 'Masuk';
    link.href = 'kelas-mahasiswa.html';
  }

  async function requireStudentSession() {
    if (!supabaseClient) return false;
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      window.location.replace(studentLoginHref('student-only'));
      return false;
    }
    const { data: profile, error } = await supabaseClient
      .from('student_profiles')
.select('user_id, nim, full_name')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error || !profile) {
      window.location.replace(studentLoginHref('student-only'));
      return false;
    }
    currentStudentProfile = profile;
    return true;
  }

  function renderHome() {
    const courseCount = courses.length;
    // Tugas di beranda harus mengikuti mahasiswa yang sedang login:
    // tugas individu untuk semua mahasiswa, tugas kelompok hanya untuk kelompoknya sendiri.
    const allTasks = courses.flatMap(course => getVisibleTasks(course).map(task => ({ course, task })));
    const groupCount = allTasks.filter(({ task }) => String(task.type || '').trim().toLowerCase() === 'kelompok').length;
    document.querySelector('[data-stat="courses"]').textContent = String(courseCount);
    document.querySelector('[data-stat="tasks"]').textContent = String(allTasks.length);
    document.querySelector('[data-stat="groups"]').textContent = String(groupCount);
    setupBrowserReminder(allTasks);

    const now = new Date();
    const deadlineAlerts = allTasks
      .map(({ course, task }) => ({ course, task, deadline: getTaskDeadline(course, task) }))
      .filter(item => item.deadline && new Date(item.deadline) >= now && new Date(item.deadline) - now <= 3 * 24 * 60 * 60 * 1000)
      .sort((first, second) => new Date(first.deadline) - new Date(second.deadline));
    const oldAlert = document.getElementById('deadlineAlert');
    if (oldAlert) oldAlert.remove();
    if (deadlineAlerts.length) {
      const alert = document.createElement('section');
      alert.id = 'deadlineAlert';
      alert.className = 'deadline-alert';
      alert.innerHTML = `<strong>⏰ Deadline mendekat</strong><span>${deadlineAlerts.slice(0, 3).map(({ course, task }) => `${escapeHTML(task.title)} · ${escapeHTML(course.name)}`).join(' • ')}</span><a href="kelas-tugas.html">Lihat tugas →</a>`;
      document.querySelector('.stats-grid')?.insertAdjacentElement('afterend', alert);
    }

    const courseList = document.getElementById('courseList');
    courseList.innerHTML = courses.map(course => `
      <a class="course-link" href="kelas-tugas.html?matkul=${encodeURIComponent(course.id)}">
        <span class="course-link-icon" aria-hidden="true">📚</span>
        <span><strong>${escapeHTML(course.name)}</strong><small>${escapeHTML(course.lecturer)} · ${escapeHTML(course.schedule)}</small></span>
      </a>
    `).join('');

    const semesterStartInfo = document.getElementById('semesterStartInfo');
    const classScheduleList = document.getElementById('classScheduleList');
    const semesterStart = portal.semesterStart ? new Date(`${portal.semesterStart}T00:00:00`) : null;
    if (semesterStartInfo && semesterStart) {
      semesterStartInfo.textContent = `Perkuliahan dimulai Rabu, ${semesterStart.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}. Jadwal ini menjadi acuan deadline tugas kelompok.`;
    }
    if (classScheduleList) {
      const scheduledCourses = courses
        .filter(course => course.classSchedule)
        .sort((first, second) => first.classSchedule.weekday - second.classSchedule.weekday || first.classSchedule.start.localeCompare(second.classSchedule.start));
      classScheduleList.innerHTML = scheduledCourses.map(course => {
        const schedule = course.classSchedule;
        const time = `${schedule.start.replace(':', '.')}–${schedule.end.replace(':', '.')}`;
        return `<tr><td>${escapeHTML(schedule.day)}</td><td>${escapeHTML(time)}</td><td><a href="kelas-tugas.html?matkul=${encodeURIComponent(course.id)}">${escapeHTML(course.name)}</a></td><td>${escapeHTML(schedule.sks)}</td><td>${escapeHTML(schedule.room)}</td></tr>`;
      }).join('') || '<tr><td colspan="5">Jadwal belum ditambahkan.</td></tr>';
    }

    const deadlineList = document.getElementById('deadlineList');
    const upcoming = allTasks.sort((a, b) => {
      const firstDeadline = getTaskDeadline(a.course, a.task);
      const secondDeadline = getTaskDeadline(b.course, b.task);
      if (firstDeadline && secondDeadline) return new Date(firstDeadline) - new Date(secondDeadline);
      if (firstDeadline) return -1;
      if (secondDeadline) return 1;
      if (a.task.meeting && b.task.meeting) return a.task.meeting - b.task.meeting;
      if (a.task.meeting) return -1;
      if (b.task.meeting) return 1;
      return 0;
    }).slice(0, 4);
    deadlineList.innerHTML = upcoming.map(({ course, task }) => {
      const group = getTaskGroup(course, task);
      const href = task.type === 'kelompok' && group
        ? groupHref(course, task, group)
        : `kelas-tugas.html?matkul=${encodeURIComponent(course.id)}`;
      const taskLabel = task.type === 'kelompok' && group ? group.name : task.title;
      return `<li class="deadline-item"><span class="deadline-date">${escapeHTML(taskScheduleLabel(course, task, true))}</span><a href="${href}"><strong>${escapeHTML(taskLabel)}</strong><small>${escapeHTML(course.name)} · ${task.type === 'kelompok' ? 'Kelompok' : 'Individu'}</small></a></li>`;
    }).join('');
  }

  function taskCard(course, task) {
    const isGroup = String(task.type || '').trim().toLowerCase() === 'kelompok';
    const group = isGroup ? getTaskGroup(course, task) : null;
    const deadline = getTaskDeadline(course, task);
    const action = isGroup && group
      ? `<a class="button button-primary" href="${groupHref(course, task, group)}">Lihat kelompok →</a>`
      : isGroup
        ? '<span class="button button-disabled" aria-disabled="true">Detail kelompok belum tersedia</span>'
      : `<button class="button button-secondary" type="button" data-task-detail="${escapeHTML(task.id)}">Lihat instruksi</button>`;
    const attachment = task.attachmentUrl
      ? `<a class="attachment-link" href="${escapeHTML(task.attachmentUrl)}" target="_blank" rel="noopener">📎 ${escapeHTML(task.attachmentName || 'Buka lampiran')}</a>`
      : '';
    const status = getTaskStatus(task);
    return `
      <article class="task-card">
        <div class="task-topline">
          <div>
            <span class="badge badge-${isGroup ? 'kelompok' : 'individu'}">${isGroup ? '👥 Kelompok' : '👤 Individu'}</span>
            <h3>${escapeHTML(isGroup && group ? group.name : task.title)}</h3>
          </div>
          <span class="due">${escapeHTML(taskScheduleLabel(course, task, true))}</span>
        </div>
        ${isGroup ? `<p class="group-task-deadline"><strong>Pertemuan ke-${escapeHTML(task.meeting || '-')}</strong>${deadline ? ` · Deadline: ${escapeHTML(formatDate(deadline))}` : ''}</p>` : `<p>${escapeHTML(task.description)}</p>`}
        <div class="task-status-row"><span class="task-status ${statusClass(status)}">${escapeHTML(status)}</span><select class="select-field task-status-select" data-task-status="${escapeHTML(task.id)}" aria-label="Status pengumpulan"><option ${status === 'Belum dikerjakan' ? 'selected' : ''}>Belum dikerjakan</option><option ${status === 'Sedang dikerjakan' ? 'selected' : ''}>Sedang dikerjakan</option><option ${status === 'Sudah dikumpulkan' ? 'selected' : ''}>Sudah dikumpulkan</option><option ${status === 'Terlambat' ? 'selected' : ''}>Terlambat</option></select></div>
        <div class="task-actions">${action}${deadline ? `<a class="button button-secondary" href="${escapeHTML(googleCalendarHref(course, task))}" target="_blank" rel="noopener">📅 Google Calendar</a>` : ''}${attachment}</div>
      </article>
    `;
  }

  function renderSubmissionInstruction(submission) {
    const value = String(submission || '').trim();
    if (!value) return '-';

    const urlPattern = /https?:\/\/[^\s<]+/gi;
    const links = value.match(urlPattern) || [];
    const textOnly = value.replace(urlPattern, '').replace(/\s{2,}/g, ' ').trim();

    if (!links.length) return escapeHTML(value);

    const buttons = links.map((url, index) => {
      const cleanUrl = url.replace(/[.,;:!?]+$/, '');
      return `<a class="button button-primary submission-link-button" href="${escapeHTML(cleanUrl)}" target="_blank" rel="noopener">🔗 ${links.length > 1 ? `Buka Link Pengumpulan ${index + 1}` : 'Buka Link Pengumpulan'}</a>`;
    }).join(' ');

    return `${textOnly ? `${escapeHTML(textOnly)}<br>` : ''}${buttons}`;
  }

  function showTaskDialog(course, task) {
    const dialog = document.getElementById('taskDialog');
    const content = document.getElementById('taskDialogContent');
    content.innerHTML = `
      <button class="dialog-close" type="button" aria-label="Tutup" data-close-dialog>×</button>
      <span class="badge badge-individu">👤 Individu</span>
      <h2>${escapeHTML(task.title)}</h2>
      <p>${escapeHTML(task.description)}</p>
      <p><strong>Deadline:</strong> ${formatDate(task.due)}</p>
      <div class="task-submission"><strong>Pengumpulan:</strong><br>${renderSubmissionInstruction(task.submission)}</div>
      ${task.due ? `<p><a class="button button-secondary" href="${escapeHTML(googleCalendarHref(course, task))}" target="_blank" rel="noopener">📅 Tambah ke Google Calendar</a></p>` : ''}
      <ul class="checklist">${task.checklist.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>
      ${task.attachmentUrl ? `<p><a class="attachment-link" href="${escapeHTML(task.attachmentUrl)}" target="_blank" rel="noopener">📎 ${escapeHTML(task.attachmentName || 'Buka lampiran')}</a></p>` : ''}
    `;
    content.querySelector('[data-close-dialog]').addEventListener('click', () => dialog.close());
    dialog.showModal();
  }

  function setupTasksPage() {
    const params = new URLSearchParams(window.location.search);
    let course = getCourse(params.get('matkul'));
    let filter = 'semua';
    let search = '';
    let deadlineRange = 'semua';
    let showArchived = false;
    let calendarDate = new Date();
    const courseSelect = document.getElementById('courseSelect');
    const courseTitle = document.getElementById('courseTitle');
    const courseInfo = document.getElementById('courseInfo');
    const taskList = document.getElementById('taskList');

    function updateURL() {
      const url = new URL(window.location.href);
      url.searchParams.set('matkul', course.id);
      window.history.replaceState({}, '', url);
    }

    function render() {
      courseSelect.innerHTML = courseOptions(course.id);
      courseTitle.textContent = course.name;
      courseInfo.textContent = `${course.lecturer} · ${course.schedule}`;
      const tasks = getVisibleTasks(course);
      const now = Date.now();
      const visibleTasks = tasks.filter(task => (showArchived || !getTaskDeadline(course, task) || new Date(getTaskDeadline(course, task)).getTime() >= now) && (filter === 'semua' || task.type === filter) && (!search || `${task.title} ${task.description}`.toLocaleLowerCase('id-ID').includes(search)) && (deadlineRange === 'semua' || (getTaskDeadline(course, task) && new Date(getTaskDeadline(course, task)).getTime() <= now + (deadlineRange === 'minggu' ? 7 : 30) * 86400000)));
      taskList.innerHTML = visibleTasks.map(task => taskCard(course, task)).join('') || '<div class="empty-state">Belum ada tugas pada kategori ini.</div>';
      taskList.querySelectorAll('[data-task-detail]').forEach(button => {
        button.addEventListener('click', () => showTaskDialog(course, getTask(course, button.dataset.taskDetail)));
      });
      taskList.querySelectorAll('[data-task-status]').forEach(select => select.addEventListener('change', () => { const task = getTask(course, select.dataset.taskStatus); if (task) { setTaskStatus(task, select.value); render(); } }));
    }

    courseSelect.addEventListener('change', () => {
      course = getCourse(courseSelect.value);
      updateURL();
      render();
    });
    document.querySelectorAll('[data-filter]').forEach(button => {
      button.addEventListener('click', () => {
        filter = button.dataset.filter;
        document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('active', item === button));
        render();
      });
    });
    document.getElementById('taskSearch')?.addEventListener('input', event => { search = event.target.value.trim().toLocaleLowerCase('id-ID'); render(); });
    document.getElementById('deadlineFilter')?.addEventListener('change', event => { deadlineRange = event.target.value; render(); });
    document.getElementById('showArchived')?.addEventListener('change', event => { showArchived = event.target.checked; render(); });
    render();
    const calendar = document.getElementById('deadlineCalendar');
    if (calendar) {
      const items = courses.flatMap(item => getVisibleTasks(item).map(task => ({ course: item, task, deadline: getTaskDeadline(item, task) }))).filter(item => item.deadline).sort((a,b) => new Date(a.deadline)-new Date(b.deadline));
      const renderCalendar = () => { const y=calendarDate.getFullYear(), m=calendarDate.getMonth(); const monthName=calendarDate.toLocaleDateString('id-ID',{month:'long',year:'numeric'}); document.getElementById('calendarMonth').textContent=monthName; const first=new Date(y,m,1).getDay(); const days=new Date(y,m+1,0).getDate(); let html=['Min','Sen','Sel','Rab','Kam','Jum','Sab'].map(day=>`<span class="calendar-weekday">${day}</span>`).join(''); for(let i=0;i<first;i++) html+='<span class="calendar-day is-empty"></span>'; for(let d=1;d<=days;d++){const matches=items.filter(item=>{const dt=new Date(item.deadline);return dt.getFullYear()===y&&dt.getMonth()===m&&dt.getDate()===d}); html+=`<span class="calendar-day"><b>${d}</b>${matches.map(item=>`<small title="${escapeHTML(item.task.title)}">${escapeHTML(item.task.title)}</small>`).join('')}</span>`;} calendar.innerHTML=html; }; renderCalendar(); document.getElementById('calendarPrev')?.addEventListener('click',()=>{calendarDate.setMonth(calendarDate.getMonth()-1);renderCalendar()}); document.getElementById('calendarNext')?.addEventListener('click',()=>{calendarDate.setMonth(calendarDate.getMonth()+1);renderCalendar()});
    }
  }

  function setupGroupLinksPage() {
    const root = document.getElementById('groupLinksPage');
    const links = Array.isArray(portal.groupLinks) && portal.groupLinks.length
      ? portal.groupLinks
      : courses.map(course => ({ label: course.name, ...course.groupLink }));
    root.innerHTML = `
      <section class="hero"><span class="eyebrow">KOMUNIKASI KELAS</span><h1>Grup matkul.</h1><p>Pilih link untuk bergabung ke grup diskusi WhatsApp mata kuliah.</p></section>
      <section class="group-links-grid">${links.map(link => {
        const hasLink = /^https:\/\//i.test(link.url || '');
        return `<article class="group-link-card"><span class="group-link-icon" aria-hidden="true">💬</span><div><span class="eyebrow" style="color:#3855c8">${escapeHTML(link.platform || 'Grup kelas')}</span><h2>${escapeHTML(link.label || 'Link Grup Mata Kuliah')}</h2><p class="link-note">${escapeHTML(link.note || 'Link grup belum tersedia.')}</p>${hasLink ? `<a class="button button-primary" href="${escapeHTML(link.url)}" target="_blank" rel="noopener">Buka grup ${escapeHTML(link.platform || '')} →</a>` : '<span class="button button-disabled" aria-disabled="true">Link belum ditambahkan</span>'}</div></article>`;
      }).join('')}</section>
      <p class="group-note">Nama pada setiap kartu dapat diubah di <strong>kelas-data.js</strong> pada bagian <strong>groupLinks</strong>, tanpa mengubah tautan WhatsApp-nya.</p>
    `;
  }

  function setupGroupPage() {
    const params = new URLSearchParams(window.location.search);
    const course = getCourse(params.get('matkul'));
    const task = getTask(course, params.get('tugas')) || course.tasks.find(item => item.type === 'kelompok');
    const group = course.groups.find(item => item.id === task?.groupId);
    const root = document.getElementById('groupPage');
    if (!task || String(task.type || '').trim().toLowerCase() !== 'kelompok' || !group || !isTaskVisibleToCurrentStudent(course, task)) {
      root.innerHTML = '<div class="error-card"><strong>Kelompok tidak dapat diakses.</strong><p>Anda hanya dapat membuka kelompok yang menjadi bagian Anda.</p><a class="button button-secondary" href="kelas-tugas.html">Kembali ke tugas saya</a></div>';
      return;
    }
    root.innerHTML = `
      <section class="hero"><span class="eyebrow">TUGAS KELOMPOK</span><h1>${escapeHTML(group.name)}</h1><p>${escapeHTML(course.name)}</p><div class="hero-actions"><a class="button button-primary" href="kelas-tugas.html?matkul=${encodeURIComponent(course.id)}">← Kembali ke tugas</a></div></section>
      <section class="group-card group-detail-card">
        <div class="group-detail-item"><span class="field-label">Nama kelompok</span><strong>${escapeHTML(group.name)}</strong></div>
        <div class="group-detail-item"><span class="field-label">${task.meeting ? 'Pertemuan & deadline' : 'Deadline'}</span><strong>${escapeHTML(taskScheduleLabel(course, task))}</strong></div>
        <div class="group-detail-item task-description"><span class="field-label">Deskripsi tugas</span><p>${escapeHTML(task.description || 'Belum ada deskripsi untuk tugas ini.')}</p></div>
        ${task.attachmentUrl ? `<div class="group-detail-item"><span class="field-label">Lampiran tugas</span><a class="attachment-link" href="${escapeHTML(task.attachmentUrl)}" target="_blank" rel="noopener">📎 ${escapeHTML(task.attachmentName || 'Buka lampiran')}</a></div>` : ''}
        ${getTaskDeadline(course, task) ? `<div class="group-detail-item"><span class="field-label">Pengingat</span><a class="button button-secondary" href="${escapeHTML(googleCalendarHref(course, task))}" target="_blank" rel="noopener">📅 Tambah ke Google Calendar</a></div>` : ''}
        <div class="group-detail-item"><span class="field-label">Nama anggota</span><ul class="member-list">${group.members.map(member => `<li><span class="member-avatar">${escapeHTML(member.name.split(' ').map(part => part[0]).slice(0, 2).join(''))}</span><strong>${escapeHTML(member.name)}</strong></li>`).join('') || '<li><strong>Anggota belum ditambahkan.</strong></li>'}</ul></div>
      </section>
    `;
  }

  async function start() {
    setupNavigation();
    setupThemeToggle();
    await updateStudentNavigation();
    if ((page === 'home' || page === 'tasks' || page === 'group') && !(await requireStudentSession())) return;
    await loadAnnouncement();
    if (page === 'home' || page === 'tasks' || page === 'group') await loadPortalData();
    if (page === 'home') renderHome();
    if (page === 'tasks') setupTasksPage();
    if (page === 'group-links') setupGroupLinksPage();
    if (page === 'group') setupGroupPage();
  }

  start();
})();
