-- Real-time chat signals (Supabase Realtime Broadcast, private channels).
-- When a message is sent, the database broadcasts a small signal (no message text) to
--   user:<requester id>  - the buyer's inbox
--   seller:<seller id>   - the store's inbox (owner and team members with the Messages section)
-- Browsers then reload the conversation through the API, which keeps doing the authorization.

create or replace function public.nx_can_read_seller_messages(p_seller_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.sellers s where s.id = p_seller_id and s.owner_user_id = auth.uid())
      or exists (
        select 1
          from public.seller_members m
          join public.seller_member_permissions g on g.seller_member_id = m.id and g.revoked_at is null
          join public.permissions p on p.id = g.permission_id and p.is_active and p.code = 'seller.area.messages'
         where m.seller_id = p_seller_id and m.user_id = auth.uid() and m.status = 'ACTIVE');
$$;

revoke all on function public.nx_can_read_seller_messages(uuid) from public;
grant execute on function public.nx_can_read_seller_messages(uuid) to authenticated;

-- Who may receive broadcasts on which private topic.
drop policy if exists nx_realtime_inbox_receive on realtime.messages;
create policy nx_realtime_inbox_receive on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (
      realtime.topic() = 'user:' || auth.uid()::text
      or (realtime.topic() ~ '^seller:[0-9a-f-]{36}$' and public.nx_can_read_seller_messages(substr(realtime.topic(), 8)::uuid))
    )
  );

create or replace function public.nx_broadcast_conversation_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  payload jsonb;
begin
  if new.status <> 'SENT' then
    return null;
  end if;
  select id, requester_user_id, seller_id, conversation_type into c from public.conversations where id = new.conversation_id;
  if c.id is null or c.conversation_type not in ('PRODUCT_INQUIRY', 'ORDER') then
    return null;
  end if;
  payload := jsonb_build_object('conversationId', new.conversation_id, 'messageId', new.id, 'seq', new.sequence_number, 'senderId', new.sender_user_id);
  begin
    perform realtime.send(payload, 'message', 'user:' || c.requester_user_id::text, true);
    if c.seller_id is not null then
      perform realtime.send(payload || jsonb_build_object('sellerId', c.seller_id), 'message', 'seller:' || c.seller_id::text, true);
    end if;
  exception when others then
    -- Real-time is best effort: never block sending a message.
    raise warning 'nx_broadcast_conversation_message: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.nx_broadcast_conversation_message() from public;

drop trigger if exists trg_conversation_messages_broadcast on public.conversation_messages;
create trigger trg_conversation_messages_broadcast
  after insert on public.conversation_messages
  for each row execute function public.nx_broadcast_conversation_message();
