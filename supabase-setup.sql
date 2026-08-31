-- Jalankan seluruh skrip ini sekali di Supabase: SQL Editor > New query > Run.
-- Setelah itu, buat akun admin di Authentication > Users, lalu jalankan blok
-- "ADMIN PERTAMA" paling bawah dengan email akun tersebut.

create table if not exists public.courses (
  id text primary key,
  name text not null unique,
  whatsapp_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  course_id text not null references public.courses(id) on delete cascade,
  type text not null check (type in ('individu', 'kelompok')),
  title text not null,
  description text not null default '',
  due_at timestamptz not null,
  checklist jsonb not null default '[]'::jsonb,
  submission text not null default '',
  attachment_name text,
  attachment_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

alter table public.courses enable row level security;
alter table public.tasks enable row level security;
alter table public.admin_users enable row level security;

revoke all on table public.courses, public.tasks, public.admin_users from anon, authenticated;
grant select on table public.courses, public.tasks to anon, authenticated;
grant insert, update, delete on table public.courses, public.tasks to authenticated;

drop policy if exists "Mata kuliah dapat dilihat publik" on public.courses;
drop policy if exists "Admin mengelola mata kuliah" on public.courses;
create policy "Mata kuliah dapat dilihat publik"
on public.courses for select to anon, authenticated using (true);
create policy "Admin mengelola mata kuliah"
on public.courses for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "Tugas dapat dilihat publik" on public.tasks;
drop policy if exists "Admin mengelola tugas" on public.tasks;
create policy "Tugas dapat dilihat publik"
on public.tasks for select to anon, authenticated using (true);
create policy "Admin mengelola tugas"
on public.tasks for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

insert into public.courses (id, name, whatsapp_url) values
  ('ilmu-pendidikan', 'Ilmu Pendidikan', 'https://chat.whatsapp.com/J4qI9KEeIrt1qxZwFI8msy'),
  ('bilangan-dan-pengolahan-data', 'Bilangan dan Pengolahan Data', 'https://chat.whatsapp.com/KPpdfYIAKMl51Cu7yMahNz'),
  ('pendidikan-inklusif', 'Pendidikan Inklusif', 'https://chat.whatsapp.com/K9oabfLOzuc3MZhx2kzO5D'),
  ('pendidikan-karakter', 'Pendidikan Karakter', 'https://chat.whatsapp.com/K3EYpg3JTzTFz5aNtQDtNv?s=cl&p=a&mlu=0&ilr=0'),
  ('psikologi-pendidikan', 'Psikologi Pendidikan', 'https://chat.whatsapp.com/DZkYQEEvyZrFONqwhNfp5N'),
  ('kajian-kebahasaan', 'Kajian Kebahasaan', 'https://chat.whatsapp.com/L159hyNaCK06u9OqxlmAiS'),
  ('konsep-dasar-ips-sd', 'Konsep Dasar IPS SD', 'https://chat.whatsapp.com/HpkiCkDquM3LX311Eion58')
on conflict (id) do update set
  name = excluded.name,
  whatsapp_url = excluded.whatsapp_url;

insert into storage.buckets (id, name, public, file_size_limit)
values ('task-attachments', 'task-attachments', true, 10485760)
on conflict (id) do update set
  public = true,
  file_size_limit = 10485760;

grant select on storage.objects to anon, authenticated;
grant insert, update, delete on storage.objects to authenticated;

drop policy if exists "Lampiran tugas dapat dilihat publik" on storage.objects;
drop policy if exists "Admin mengunggah lampiran tugas" on storage.objects;
drop policy if exists "Admin memperbarui lampiran tugas" on storage.objects;
drop policy if exists "Admin menghapus lampiran tugas" on storage.objects;
create policy "Lampiran tugas dapat dilihat publik"
on storage.objects for select to anon, authenticated
using (bucket_id = 'task-attachments');
create policy "Admin mengunggah lampiran tugas"
on storage.objects for insert to authenticated
with check (bucket_id = 'task-attachments' and (select public.is_admin()));
create policy "Admin memperbarui lampiran tugas"
on storage.objects for update to authenticated
using (bucket_id = 'task-attachments' and (select public.is_admin()))
with check (bucket_id = 'task-attachments' and (select public.is_admin()));
create policy "Admin menghapus lampiran tugas"
on storage.objects for delete to authenticated
using (bucket_id = 'task-attachments' and (select public.is_admin()));

-- ADMIN GLOBAL (OPSIONAL)
-- Untuk akses satu akun per mata kuliah, jalankan juga supabase-course-admins-setup.sql.
-- 1. Buat pengguna melalui Authentication > Users > Add user.
-- 2. Ganti email di bawah, lalu jalankan perintah ini secara terpisah:
-- insert into public.admin_users (user_id)
-- select id from auth.users where email = 'admin@email-anda.com'
-- on conflict (user_id) do nothing;
