/** The store's active program and the referral rule in force, if any. */
export const activeAffiliateProgramSql = (sellerId: string) => `
  select rp.id as program_id, rp.attribution_window_days, cand.rule_version_id, d.percentage_rate::text as rate,
         case when jsonb_typeof(cand.conditions->'productIds') = 'array'
              then nullif(cand.conditions->'productIds', '[]'::jsonb)
         end as product_ids
    from public.nx_seller_affiliate_programs nsp
    join public.referral_programs rp on rp.id = nsp.program_id and rp.status = 'ACTIVE'
    join public.business_rule_groups g on g.id = nsp.rule_group_id and g.status = 'ACTIVE'
    join lateral (
      select x.rule_version_id, x.conditions
        from public.get_business_rule_candidates('REFERRAL_COMMISSION', nsp.seller_id, null, null, null, now()) x
       where x.rule_group_id = nsp.rule_group_id
       order by x.effective_from desc, x.version_number desc limit 1
    ) cand on true
    join public.referral_rule_definitions d on d.rule_version_id = cand.rule_version_id and d.program_id = rp.id
   where nsp.seller_id = ${sellerId}`;
