-- Shipping policy v2: the destination selector is called «Enviar a» / “Deliver to” / « Envoyer à » / «Voye bay»
-- in the site (it said «Entregar en», « Livrer en », «Livre nan»). Publishes a new version; v1 stays in history.
do $$
declare
  v_old uuid; v_policy uuid; v_new uuid; v_actor uuid;
begin
  select v.id, v.policy_id into v_old, v_policy
    from public.policies p join public.policy_versions v on v.policy_id = p.id
   where p.code = 'SHIPPING_POLICY' and v.status = 'PUBLISHED'
   order by v.version_number desc limit 1;
  if v_old is null or not exists (
    select 1 from public.policy_version_localizations
     where policy_version_id = v_old
       and (content->>'text' like '%«Entregar en»%' or content->>'text' like '%« Livrer en »%' or content->>'text' like '%«Livre nan»%')
  ) then
    return; -- already fixed or edited by an administrator
  end if;
  insert into public.policy_versions (policy_id, version_number)
  values (v_policy, (select max(version_number) + 1 from public.policy_versions where policy_id = v_policy))
  returning id into v_new;
  insert into public.policy_version_localizations (policy_version_id, locale, title, content_format, content)
  select v_new, locale, title, content_format,
         jsonb_set(content, '{text}', to_jsonb(replace(replace(replace(content->>'text',
           '«Entregar en»', '«Enviar a»'), '« Livrer en »', '« Envoyer à »'), '«Livre nan»', '«Voye bay»')))
    from public.policy_version_localizations where policy_version_id = v_old;
  select ur.user_id into v_actor from public.user_roles ur join public.roles r on r.id = ur.role_id join public.users u on u.id = ur.user_id
   where r.code = 'SUPER_ADMIN' and ur.revoked_at is null and u.status = 'ACTIVE' order by u.created_at limit 1;
  perform public.publish_policy_version(v_new, v_actor, now());
end $$;
