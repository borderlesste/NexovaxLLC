-- Realtime caches Broadcast read authorization for the lifetime of a channel join.
-- Route every inbox signal to a specific recipient and check eligibility at send time too.
create or replace function public.nx_current_inbox_user()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
    from public.users u
   where u.id = auth.uid()
     and u.status::text not in ('SUSPENDED', 'BLOCKED', 'CLOSED')
     and (auth.jwt() ->> 'is_anonymous') is distinct from 'true';
$$;

revoke all on function public.nx_current_inbox_user() from public;
grant execute on function public.nx_current_inbox_user() to authenticated;

drop policy if exists nx_realtime_inbox_receive on realtime.messages;
create policy nx_realtime_inbox_receive on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'user:' || (select public.nx_current_inbox_user())::text
  );

drop function if exists public.nx_can_read_seller_messages(uuid);

create or replace function public.nx_broadcast_conversation_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  seller record;
  recipient record;
  payload jsonb;
begin
  if new.status <> 'SENT' then
    return null;
  end if;
  select requester_user_id, seller_id, conversation_type into c
    from public.conversations where id = new.conversation_id;
  if not found or c.conversation_type not in ('PRODUCT_INQUIRY', 'ORDER') then
    return null;
  end if;

  payload := jsonb_build_object('conversationId', new.conversation_id, 'messageId', new.id, 'seq', new.sequence_number, 'senderId', new.sender_user_id);
  begin
    select id, owner_user_id into seller from public.sellers
     where id = c.seller_id and status <> 'SUSPENDED' for share;

    -- Lock recipients against account status updates through commit. In particular,
    -- a suspension that has already acquired the user row lock wins over this send.
    for recipient in
      select u.id, u.id is distinct from c.requester_user_id as seller_inbox
        from (
          select c.requester_user_id as user_id
          union
          select seller.owner_user_id
          union
          select m.user_id
            from public.seller_members m
            join public.seller_member_permissions g on g.seller_member_id = m.id and g.revoked_at is null
            join public.permissions p on p.id = g.permission_id and p.is_active and p.code = 'seller.area.messages'
           where m.seller_id = seller.id and m.status = 'ACTIVE'
        ) eligible
        join public.users u on u.id = eligible.user_id
       where u.status::text not in ('SUSPENDED', 'BLOCKED', 'CLOSED')
       order by u.id for share of u
    loop
      perform realtime.send(
        case when recipient.seller_inbox then payload || jsonb_build_object('sellerId', c.seller_id) else payload end,
        'message', 'user:' || recipient.id::text, true
      );
    end loop;
  exception when others then
    -- Real-time is best effort: never block sending a message.
    raise warning 'nx_broadcast_conversation_message: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.nx_broadcast_conversation_message() from public;
