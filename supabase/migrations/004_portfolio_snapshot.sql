-- Vienu SQL sakiniu perskaitomas nuoseklus vartotojo portfelis.
-- Reikia 001. Jokių finansinių duomenų keitimų ar išorinių API kvietimų.
begin;
create function public.get_portfolio_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', p.id,
    'cash_balance', p.cash_balance::text,
    'snapshot_at', statement_timestamp(),
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'symbol', pos.symbol,
        'quantity', pos.quantity,
        'average_cost', pos.average_cost::text
      ) order by pos.symbol)
      from public.positions as pos
      where pos.user_id = p.id
    ), '[]'::jsonb)
  )
  from public.profiles as p
  where p.id = (select auth.uid())
    and (select auth.role()) = 'authenticated';
$$;
revoke all on function public.get_portfolio_snapshot() from public, anon, authenticated, service_role;
grant execute on function public.get_portfolio_snapshot() to authenticated;
comment on function public.get_portfolio_snapshot() is
  'Tik savo balansas ir pozicijos vienu DB skaitymo momentu; esamos RLS politikos taikomos.';
commit;
