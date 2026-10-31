-- 레시피 사진 저장 공간 (공개 읽기 · 로그인한 사람만 올리기/지우기)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipes', 'recipes', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true;

drop policy if exists "recipes read" on storage.objects;
create policy "recipes read" on storage.objects for select using (bucket_id = 'recipes');
drop policy if exists "recipes upload" on storage.objects;
create policy "recipes upload" on storage.objects for insert to authenticated with check (bucket_id = 'recipes');
drop policy if exists "recipes delete" on storage.objects;
create policy "recipes delete" on storage.objects for delete to authenticated using (bucket_id = 'recipes');
