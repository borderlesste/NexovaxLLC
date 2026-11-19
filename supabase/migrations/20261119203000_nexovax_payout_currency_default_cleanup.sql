-- Deleted (DISABLED) payout methods kept the store's default for their currency, so the
-- unique index uq_seller_payout_account_currency_default rejected every new method in that
-- currency ("Ya existe un registro con esos datos"). Release those defaults.
update public.seller_payout_account_currencies c set is_default = false
  from public.seller_payout_accounts a
 where a.id = c.payout_account_id and a.status = 'DISABLED' and c.is_default;
