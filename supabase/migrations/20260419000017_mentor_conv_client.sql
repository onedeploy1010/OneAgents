-- 让 mentor_conversations.trainee_user_id 可空,以便存客户对话(客户不是 trainee)。
-- metadata 里存 client_id / contact_id。

begin;

alter table mentor_conversations alter column trainee_user_id drop not null;

create index if not exists idx_mentor_conv_client_id on mentor_conversations((metadata->>'client_id')) where metadata ? 'client_id';

commit;
