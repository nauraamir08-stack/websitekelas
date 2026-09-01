-- Jalankan sekali setelah supabase-course-admins-setup.sql.
create table if not exists public.course_files (
  id uuid primary key default gen_random_uuid(),
  course_id text not null references public.courses(id) on delete cascade,
  name text not null,
  file_name text not null,
  file_url text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.course_files enable row level security;
revoke all on public.course_files from anon, authenticated;
grant select on public.course_files to anon, authenticated;
grant insert, update, delete on public.course_files to authenticated;
drop policy if exists "Berkas dapat dilihat" on public.course_files;
drop policy if exists "Pengampu mengelola berkas" on public.course_files;
create policy "Berkas dapat dilihat" on public.course_files for select to anon, authenticated using (true);
create policy "Pengampu mengelola berkas" on public.course_files for all to authenticated
using ((select public.can_manage_course(course_id)))
with check ((select public.can_manage_course(course_id)));

insert into storage.buckets (id, name, public, file_size_limit)
values ('course-files', 'course-files', true, 20971520)
on conflict (id) do update set public = true, file_size_limit = 20971520;
grant select on storage.objects to anon, authenticated;
grant insert, update, delete on storage.objects to authenticated;
drop policy if exists "Berkas matkul dapat dilihat" on storage.objects;
drop policy if exists "Pengampu mengunggah berkas matkul" on storage.objects;
drop policy if exists "Pengampu memperbarui berkas matkul" on storage.objects;
drop policy if exists "Pengampu menghapus berkas matkul" on storage.objects;
create policy "Berkas matkul dapat dilihat" on storage.objects for select to anon, authenticated using (bucket_id = 'course-files');
create policy "Pengampu mengunggah berkas matkul" on storage.objects for insert to authenticated
with check (bucket_id = 'course-files' and (select public.can_manage_course((storage.foldername(name))[1])));
create policy "Pengampu memperbarui berkas matkul" on storage.objects for update to authenticated
using (bucket_id = 'course-files' and (select public.can_manage_course((storage.foldername(name))[1])));
create policy "Pengampu menghapus berkas matkul" on storage.objects for delete to authenticated
using (bucket_id = 'course-files' and (select public.can_manage_course((storage.foldername(name))[1])));
