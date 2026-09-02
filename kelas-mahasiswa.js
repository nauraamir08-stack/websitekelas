'use strict';

(() => {
  const root = document.getElementById('studentPage');
  const config = window.SUPABASE_CONFIG;
  const api = window.supabase;
  const params = new URLSearchParams(window.location.search);

  if (!root) return;

  const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[char]));

  if (!api?.createClient || !config?.url || !config?.publishableKey) {
    root.innerHTML = '<div class="error-card"><strong>Konfigurasi Supabase belum tersedia.</strong><p>Periksa berkas <code>kelas-supabase.js</code>.</p></div>';
    return;
  }

  const client = api.createClient(config.url, config.publishableKey);
  const safeNextPage = () => {
    const next = params.get('next') || 'kelas-tugas.html';
    return /^kelas-(tugas|kelompok|kelompok-saya)\.html(?:\?.*)?$/i.test(next) ? next : 'kelas-tugas.html';
  };

  function setActiveNavigation() {
    document.querySelectorAll('.main-nav a').forEach(link => {
      if (link.dataset.nav === 'student') link.setAttribute('aria-current', 'page');
    });
  }

  function passwordIcon(visible) {
    return visible
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.7 10.7 0 0 1 12 4c5.2 0 8.7 4.1 9.7 6.5a1.4 1.4 0 0 1 0 1c-.6 1.5-1.9 3.3-3.9 4.6M6.5 6.5C4.1 7.9 2.7 10.2 2.3 11.5a1.4 1.4 0 0 0 0 1C3.3 14.9 6.8 19 12 19c1 0 2-.2 2.9-.5"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.3 11.5a1.4 1.4 0 0 0 0 1C3.3 14.9 6.8 19 12 19s8.7-4.1 9.7-6.5a1.4 1.4 0 0 0 0-1C20.7 9.1 17.2 5 12 5S3.3 9.1 2.3 11.5Z"/><circle cx="12" cy="12" r="3"/></svg>';
  }

  function setupPasswordToggles(scope) {
    scope.querySelectorAll('[data-password-toggle]').forEach(button => {
      const input = button.closest('.password-field')?.querySelector('input');
      if (!input) return;
      button.innerHTML = passwordIcon(false);
      button.addEventListener('click', () => {
        const visible = input.type === 'password';
        input.type = visible ? 'text' : 'password';
        button.setAttribute('aria-label', visible ? 'Sembunyikan password' : 'Tampilkan password');
        button.setAttribute('title', visible ? 'Sembunyikan password' : 'Tampilkan password');
        button.setAttribute('aria-pressed', String(visible));
        button.innerHTML = passwordIcon(visible);
      });
    });
  }

  function showLogin(message = '') {
    root.innerHTML = `
      <section class="hero student-hero"><span class="eyebrow">AKSES MAHASISWA</span><h1>Lihat tugas kamu.</h1><p>Masuk dengan NIM dan password untuk melihat tugas individu serta kelompok yang menjadi milikmu.</p></section>
      <section class="panel student-auth-card">
        <div class="panel-heading"><div><h2>Masuk mahasiswa</h2><p>Kamu tidak perlu memasukkan email.</p></div></div>
        ${message ? `<p class="form-message form-message-error">${escapeHTML(message)}</p>` : ''}
        <form id="studentLoginForm" class="admin-form">
          <label><span class="field-label">NIM</span><input class="text-field" name="nim" inputmode="numeric" autocomplete="username" maxlength="20" placeholder="Contoh: 26010644279" required></label>
          <label><span class="field-label">Password</span><span class="password-field"><input class="text-field" name="password" type="password" autocomplete="current-password" maxlength="72" required><button class="password-toggle" type="button" data-password-toggle aria-label="Tampilkan password" aria-pressed="false" title="Tampilkan password"></button></span></label>
          <button class="button button-primary" type="submit">Masuk ke tugas saya →</button>
        </form>
      </section>
    `;
    const form = root.querySelector('#studentLoginForm');
    setupPasswordToggles(form);
    form.addEventListener('submit', signIn);
  }

  async function getOwnProfile() {
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) return { profile: null, error: userError };
    const { data: profile, error } = await client
      .from('student_profiles')
      .select('nim, full_name')
      .eq('user_id', user.id)
      .maybeSingle();
    return { profile, error };
  }

  async function signIn(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const nim = form.elements.nim.value.replace(/\s+/g, '');
    if (!/^\d{8,20}$/.test(nim)) {
      showLogin('Masukkan NIM berupa angka yang valid.');
      return;
    }

    button.disabled = true;
    button.textContent = 'Memeriksa akun…';
    const { error } = await client.auth.signInWithPassword({
      email: `${nim}@kelas-h.local`,
      password: form.elements.password.value,
    });
    if (error) {
      showLogin('NIM atau password tidak sesuai.');
      return;
    }

    const { profile, error: profileError } = await getOwnProfile();
    if (profileError || !profile) {
      await client.auth.signOut();
      showLogin('Akun ditemukan, tetapi profil mahasiswa belum diaktifkan. Hubungi admin kelas.');
      return;
    }
    window.location.replace(safeNextPage());
  }

  async function showDashboard(profile) {
    const [{ data: tasks, error: taskError }, { data: courses, error: courseError }] = await Promise.all([
      client.from('tasks').select('id, type, course_id'),
      client.from('courses').select('id, name'),
    ]);
    const courseNameById = new Map((courses || []).map(course => [course.id, course.name]));
    const individualCount = (tasks || []).filter(task => task.type === 'individu').length;
    const groupCount = (tasks || []).filter(task => task.type === 'kelompok').length;
    const taskMessage = taskError || courseError
      ? 'Data tugas belum dapat dimuat. Coba buka halaman tugas kembali.'
      : `Kamu memiliki ${individualCount} tugas individu dan ${groupCount} tugas kelompok yang dapat diakses.`;
    const activeCourses = [...new Set((tasks || []).map(task => courseNameById.get(task.course_id)).filter(Boolean))];
    const completedCount = (tasks || []).filter(task => localStorage.getItem(`task-status-${task.id}`) === 'Sudah dikumpulkan').length;
    const progressPercent = tasks?.length ? Math.round((completedCount / tasks.length) * 100) : 0;

    root.innerHTML = `
      <section class="hero student-hero"><span class="eyebrow">DASHBOARD MAHASISWA</span><h1>Halo, ${escapeHTML(profile.full_name)}.</h1><p>NIM ${escapeHTML(profile.nim)} · ${escapeHTML(taskMessage)}</p><div class="hero-actions"><a class="button button-primary" href="${escapeHTML(safeNextPage())}">Lihat tugas saya →</a><button id="studentSignOut" class="button button-secondary" type="button">Keluar</button></div></section>
      <section class="panel profile-card"><div class="profile-avatar">${escapeHTML(profile.full_name.split(' ').map(part => part[0]).slice(0,2).join(''))}</div><div><span class="eyebrow">PROFIL MAHASISWA</span><h2>${escapeHTML(profile.full_name)}</h2><p>NIM ${escapeHTML(profile.nim)} · ${activeCourses.length} mata kuliah aktif</p></div></section>
      <section class="panel student-summary-panel"><div class="panel-heading"><div><h2>Mata kuliah dengan tugas</h2><p>Tugas kelompok hanya tampil jika kamu terdaftar sebagai anggota kelompok tersebut.</p></div></div><div class="student-course-chips">${activeCourses.map(name => `<span>${escapeHTML(name)}</span>`).join('') || '<p class="empty-inline">Belum ada tugas yang tersedia untukmu.</p>'}</div></section>
      <section class="panel student-summary-panel"><div class="panel-heading"><div><h2>Progres tugas</h2><p>${completedCount} dari ${tasks?.length || 0} tugas ditandai sudah dikumpulkan.</p></div><strong class="dashboard-progress-value">${progressPercent}%</strong></div><div class="progress-track"><div class="progress-value" style="width:${progressPercent}%"></div></div></section>
      <section class="panel student-summary-panel"><div class="panel-heading"><div><h2>Ganti password</h2><p>Buat password baru untuk akunmu. Gunakan minimal 6 karakter.</p></div></div><form id="changeStudentPasswordForm" class="admin-form"><label><span class="field-label">Password saat ini *</span><span class="password-field"><input class="text-field" name="currentPassword" type="password" autocomplete="current-password" required><button class="password-toggle" type="button" data-password-toggle aria-label="Tampilkan password" aria-pressed="false" title="Tampilkan password"></button></span></label><label><span class="field-label">Password baru *</span><span class="password-field"><input class="text-field" name="newPassword" type="password" autocomplete="new-password" minlength="6" maxlength="72" required><button class="password-toggle" type="button" data-password-toggle aria-label="Tampilkan password" aria-pressed="false" title="Tampilkan password"></button></span></label><label><span class="field-label">Ulangi password baru *</span><span class="password-field"><input class="text-field" name="confirmPassword" type="password" autocomplete="new-password" minlength="6" maxlength="72" required><button class="password-toggle" type="button" data-password-toggle aria-label="Tampilkan password" aria-pressed="false" title="Tampilkan password"></button></span></label><p id="changePasswordMessage" class="form-message" aria-live="polite"></p><button class="button button-primary" type="submit">Simpan password baru</button></form></section>
    `;
    root.querySelector('#studentSignOut').addEventListener('click', async () => {
      await client.auth.signOut();
      showLogin();
    });
    const passwordForm = root.querySelector('#changeStudentPasswordForm');
    setupPasswordToggles(passwordForm);
    passwordForm.addEventListener('submit', event => changePassword(event, profile));
  }

  async function changePassword(event, profile) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = root.querySelector('#changePasswordMessage');
    const button = form.querySelector('button[type="submit"]');
    const currentPassword = form.elements.currentPassword.value;
    const newPassword = form.elements.newPassword.value;
    if (newPassword.length < 6) {
      message.className = 'form-message form-message-error';
      message.textContent = 'Password baru minimal 6 karakter.';
      return;
    }
    if (newPassword !== form.elements.confirmPassword.value) {
      message.className = 'form-message form-message-error';
      message.textContent = 'Ulangi password baru harus sama.';
      return;
    }
    button.disabled = true;
    button.textContent = 'Memeriksa password…';
    const { data: { user }, error: userError } = await client.auth.getUser();
    const { error: verifyError } = userError || !user?.email
      ? { error: new Error('Sesi tidak valid.') }
      : await client.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (verifyError) {
      message.className = 'form-message form-message-error';
      message.textContent = 'Password saat ini tidak sesuai.';
      button.disabled = false;
      button.textContent = 'Simpan password baru';
      return;
    }
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) {
      message.className = 'form-message form-message-error';
      message.textContent = `Password belum diperbarui: ${error.message}`;
      button.disabled = false;
      button.textContent = 'Simpan password baru';
      return;
    }
    form.reset();
    message.className = 'form-message form-message-success';
    message.textContent = `Password untuk akun ${profile.nim} berhasil diperbarui.`;
    button.disabled = false;
    button.textContent = 'Simpan password baru';
  }

  async function start() {
    setActiveNavigation();
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      showLogin(params.get('reason') === 'student-only' ? 'Halaman tugas hanya dapat dibuka setelah masuk sebagai mahasiswa.' : '');
      return;
    }
    const { profile, error } = await getOwnProfile();
    if (error || !profile) {
      showLogin('Sesi saat ini bukan akun mahasiswa. Masukkan NIM dan password mahasiswa untuk melanjutkan.');
      return;
    }
    await showDashboard(profile);
  }

  start();
})();
