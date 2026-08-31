-- Jalankan setelah supabase-setup.sql dan supabase-groups-setup.sql.
-- Satu akun Supabase hanya dapat mengelola satu mata kuliah.

create table if not exists public.course_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  course_id text not null unique references public.courses(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.course_admins enable row level security;
revoke all on table public.course_admins from anon, authenticated;
grant select on table public.course_admins to authenticated;

drop policy if exists "Pengampu melihat akses sendiri" on public.course_admins;
create policy "Pengampu melihat akses sendiri"
on public.course_admins for select to authenticated
using (user_id = (select auth.uid()));

create or replace function public.has_course_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.course_admins
    where user_id = (select auth.uid())
  );
$$;

create or replace function public.can_manage_course(target_course_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.course_admins
    where user_id = (select auth.uid())
      and course_id = target_course_id
  );
$$;

create or replace function public.can_manage_group(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.groups as class_group
    join public.course_admins as course_admin on course_admin.course_id = class_group.course_id
    where class_group.id = target_group_id
      and course_admin.user_id = (select auth.uid())
  );
$$;

revoke all on function public.has_course_access() from public;
revoke all on function public.can_manage_course(text) from public;
revoke all on function public.can_manage_group(uuid) from public;
grant execute on function public.has_course_access() to authenticated;
grant execute on function public.can_manage_course(text) to authenticated;
grant execute on function public.can_manage_group(uuid) to authenticated;

-- Ganti akses admin global dengan akses per mata kuliah.
drop policy if exists "Admin mengelola tugas" on public.tasks;
drop policy if exists "Pengampu menambah tugas mata kuliah" on public.tasks;
drop policy if exists "Pengampu memperbarui tugas mata kuliah" on public.tasks;
drop policy if exists "Pengampu menghapus tugas mata kuliah" on public.tasks;
create policy "Pengampu menambah tugas mata kuliah"
on public.tasks for insert to authenticated
with check ((select public.can_manage_course(course_id)));
create policy "Pengampu memperbarui tugas mata kuliah"
on public.tasks for update to authenticated
using ((select public.can_manage_course(course_id)))
with check ((select public.can_manage_course(course_id)));
create policy "Pengampu menghapus tugas mata kuliah"
on public.tasks for delete to authenticated
using ((select public.can_manage_course(course_id)));

drop policy if exists "Admin mengelola kelompok" on public.groups;
drop policy if exists "Pengampu mengelola kelompok mata kuliah" on public.groups;
create policy "Pengampu mengelola kelompok mata kuliah"
on public.groups for all to authenticated
using ((select public.can_manage_course(course_id)))
with check ((select public.can_manage_course(course_id)));

drop policy if exists "Admin mengelola anggota kelompok" on public.group_members;
drop policy if exists "Pengampu mengelola anggota kelompok" on public.group_members;
create policy "Pengampu mengelola anggota kelompok"
on public.group_members for all to authenticated
using ((select public.can_manage_group(group_id)))
with check ((select public.can_manage_group(group_id)));

-- Lampiran baru disimpan dalam folder course_id/, sehingga aksesnya juga dibatasi per mata kuliah.
drop policy if exists "Admin mengunggah lampiran tugas" on storage.objects;
drop policy if exists "Admin memperbarui lampiran tugas" on storage.objects;
drop policy if exists "Admin menghapus lampiran tugas" on storage.objects;
drop policy if exists "Pengampu mengunggah lampiran tugas" on storage.objects;
drop policy if exists "Pengampu memperbarui lampiran tugas" on storage.objects;
drop policy if exists "Pengampu menghapus lampiran tugas" on storage.objects;
create policy "Pengampu mengunggah lampiran tugas"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'task-attachments'
  and (select public.can_manage_course((storage.foldername(name))[1]))
);
create policy "Pengampu memperbarui lampiran tugas"
on storage.objects for update to authenticated
using (
  bucket_id = 'task-attachments'
  and (select public.can_manage_course((storage.foldername(name))[1]))
)
with check (
  bucket_id = 'task-attachments'
  and (select public.can_manage_course((storage.foldername(name))[1]))
);
create policy "Pengampu menghapus lampiran tugas"
on storage.objects for delete to authenticated
using (
  bucket_id = 'task-attachments'
  and (select public.can_manage_course((storage.foldername(name))[1]))
);

-- BUAT AKUN DAN HUBUNGKAN KE MATA KULIAH
-- 1. Buat satu pengguna per mata kuliah melalui Authentication > Users > Add user.
-- 2. Ganti email dan course_id di bawah, lalu jalankan untuk setiap mata kuliah:
-- insert into public.course_admins (user_id, course_id)
-- select id, 'ilmu-pendidikan'
-- from auth.users
-- where email = 'ilmu-pendidikan@kelas.com'
-- on conflict (user_id) do update set course_id = excluded.course_id;
