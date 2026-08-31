-- Jalankan skrip ini sekali di Supabase: SQL Editor > New query > Run.
-- Jalankan setelah supabase-setup.sql berhasil dijalankan.

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  course_id text not null references public.courses(id) on delete cascade,
  name text not null,
  progress integer not null default 0 check (progress between 0 and 100),
  created_at timestamptz not null default now()
);

-- Nama kelompok dapat dipakai kembali pada tugas lain di mata kuliah yang sama.
-- Setiap kelompok tetap hanya terhubung ke satu tugas melalui tasks.group_id.
alter table public.groups drop constraint if exists groups_course_id_name_key;
create index if not exists groups_course_name_index on public.groups (course_id, name);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- Menyesuaikan jika skrip versi sebelumnya pernah dijalankan.
alter table public.group_members drop column if exists role;
alter table public.group_members drop column if exists status;
alter table public.group_members drop column if exists task;
create unique index if not exists group_members_group_name_unique
on public.group_members (group_id, name);

alter table public.tasks add column if not exists group_id uuid
references public.groups(id) on delete set null;

-- Tugas kelompok menggunakan nomor pertemuan, bukan tanggal deadline.
alter table public.tasks add column if not exists meeting smallint
check (meeting between 1 and 16);
alter table public.tasks alter column due_at drop not null;

-- Satu kelompok hanya dapat digunakan oleh satu tugas kelompok.
create unique index if not exists tasks_group_id_unique
on public.tasks (group_id)
where group_id is not null;

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

revoke all on table public.groups, public.group_members from anon, authenticated;
grant select on table public.groups, public.group_members to anon, authenticated;
grant insert, update, delete on table public.groups, public.group_members to authenticated;

drop policy if exists "Kelompok dapat dilihat publik" on public.groups;
drop policy if exists "Admin mengelola kelompok" on public.groups;
create policy "Kelompok dapat dilihat publik"
on public.groups for select to anon, authenticated using (true);
create policy "Admin mengelola kelompok"
on public.groups for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "Anggota kelompok dapat dilihat publik" on public.group_members;
drop policy if exists "Admin mengelola anggota kelompok" on public.group_members;
create policy "Anggota kelompok dapat dilihat publik"
on public.group_members for select to anon, authenticated using (true);
create policy "Admin mengelola anggota kelompok"
on public.group_members for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));
