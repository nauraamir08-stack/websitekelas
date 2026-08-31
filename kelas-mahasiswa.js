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
    return /^kelas-(tugas|kelompok)\.html(?:\?.*)?$/i.test(next) ? next : 'kelas-tugas.html';
  };

  function setActiveNavigation() {
    document.querySelectorAll('.main-nav a').forEach(link => {
      if (link.dataset.nav === 'student') link.setAttribute('aria-current', 'page');
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
          <label><span class="field-label">Password</span><input class="text-field" name="password" type="password" autocomplete="current-password" maxlength="72" required></label>
          <button class="button button-primary" type="submit">Masuk ke tugas saya →</button>
        </form>
      </section>
    `;
    root.querySelector('#studentLoginForm').addEventListener('submit', signIn);
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

    root.innerHTML = `
      <section class="hero student-hero"><span class="eyebrow">DASHBOARD MAHASISWA</span><h1>Halo, ${escapeHTML(profile.full_name)}.</h1><p>NIM ${escapeHTML(profile.nim)} · ${escapeHTML(taskMessage)}</p><div class="hero-actions"><a class="button button-primary" href="${escapeHTML(safeNextPage())}">Lihat tugas saya →</a><button id="studentSignOut" class="button button-secondary" type="button">Keluar</button></div></section>
      <section class="panel student-summary-panel"><div class="panel-heading"><div><h2>Mata kuliah dengan tugas</h2><p>Tugas kelompok hanya tampil jika kamu terdaftar sebagai anggota kelompok tersebut.</p></div></div><div class="student-course-chips">${activeCourses.map(name => `<span>${escapeHTML(name)}</span>`).join('') || '<p class="empty-inline">Belum ada tugas yang tersedia untukmu.</p>'}</div></section>
    `;
    root.querySelector('#studentSignOut').addEventListener('click', async () => {
      await client.auth.signOut();
      showLogin();
    });
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
