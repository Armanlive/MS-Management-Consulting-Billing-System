-- Run once in Supabase SQL Editor. Review before running in an existing database.
create extension if not exists pgcrypto;
create table if not exists public.profiles(id uuid primary key references auth.users(id) on delete cascade,email text not null,role text not null default 'staff' check(role in ('admin','staff')),created_at timestamptz default now());
create table if not exists public.company_settings(id uuid primary key default '00000000-0000-0000-0000-000000000001',business_name text,issuer_name text,address text,gstin text,pan text,state_code text default '29',bank_name text,account_name text,account_number text,ifsc text);
create table if not exists public.customers(id uuid primary key default gen_random_uuid(),name text not null,address text,email text,phone text,gstin text,pan text,state text,state_code text default '29',created_at timestamptz default now());
create sequence if not exists public.invoice_sequence start 1;
create table if not exists public.invoices(id uuid primary key default gen_random_uuid(),invoice_number text unique not null default ('INV-'||to_char(now(),'YYYY')||'-'||lpad(nextval('public.invoice_sequence')::text,5,'0')),customer_id uuid not null references public.customers(id),invoice_date date not null default current_date,financial_year text not null,description text not null,hsn_sac text,subtotal numeric(14,2) not null check(subtotal>=0),gst_rate numeric(5,2) not null check(gst_rate between 0 and 100),tax_type text not null,tax_amount numeric(14,2) not null check(tax_amount>=0),total numeric(14,2) not null check(total>=0),status text not null default 'unpaid' check(status in ('unpaid','partial','paid')),notes text,created_by uuid references auth.users(id),created_at timestamptz default now());
create table if not exists public.payments(id uuid primary key default gen_random_uuid(),invoice_id uuid not null references public.invoices(id) on delete restrict,amount numeric(14,2) not null check(amount>0),payment_date date not null default current_date,method text,reference text,created_at timestamptz default now());
create table if not exists public.signup_invites(id uuid primary key default gen_random_uuid(),email text not null,code_hash text not null unique,role text not null check(role in ('admin','staff')),expires_at timestamptz not null,used_at timestamptz,created_at timestamptz default now());
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin') $$;
revoke all on function public.is_admin() from public;grant execute on function public.is_admin() to authenticated;
-- Trusted DB recalculation prevents browser-side amount or GST manipulation.
create or replace function public.validate_invoice() returns trigger language plpgsql security definer set search_path='' as $$ declare supplier text; customer_state text; begin select coalesce(state_code,'29') into supplier from public.company_settings limit 1; select coalesce(state_code,'29') into customer_state from public.customers where id=new.customer_id; new.tax_type:=case when new.gst_rate=0 then 'EXEMPT' when coalesce(supplier,'29')=customer_state then 'CGST + SGST' else 'IGST' end;new.tax_amount:=round(new.subtotal*new.gst_rate/100,2);new.total:=new.subtotal+new.tax_amount;return new;end $$;
drop trigger if exists invoice_validate on public.invoices;create trigger invoice_validate before insert or update on public.invoices for each row execute function public.validate_invoice();
create or replace function public.update_invoice_payment_status() returns trigger language plpgsql security definer set search_path='' as $$ declare invoice_uuid uuid; paid numeric; billed numeric;begin invoice_uuid:=coalesce(new.invoice_id,old.invoice_id);select coalesce(sum(amount),0) into paid from public.payments where invoice_id=invoice_uuid;select total into billed from public.invoices where id=invoice_uuid;update public.invoices set status=case when paid>=billed then 'paid' when paid>0 then 'partial' else 'unpaid' end where id=invoice_uuid;return null;end $$;
drop trigger if exists payment_status_update on public.payments;create trigger payment_status_update after insert or update or delete on public.payments for each row execute function public.update_invoice_payment_status();
-- Invoice status is derived from payments, never client-supplied.
create or replace function public.protect_invoice_status() returns trigger language plpgsql set search_path='' as $$ begin if tg_op='INSERT' then new.status:='unpaid';else new.status:=old.status;end if;return new;end $$;
-- Not installed: payment trigger updates status and would be blocked by the above trigger.
alter table public.profiles enable row level security;alter table public.company_settings enable row level security;alter table public.customers enable row level security;alter table public.invoices enable row level security;alter table public.payments enable row level security;alter table public.signup_invites enable row level security;
create policy "profiles read" on public.profiles for select to authenticated using (id=(select auth.uid()) or public.is_admin());
create policy "company read" on public.company_settings for select to authenticated using (true);
create policy "company admin insert" on public.company_settings for insert to authenticated with check(public.is_admin());
create policy "company admin update" on public.company_settings for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "customers read" on public.customers for select to authenticated using(true);
create policy "customers write" on public.customers for insert to authenticated with check(true);
create policy "customers edit" on public.customers for update to authenticated using(true) with check(true);
create policy "invoices read" on public.invoices for select to authenticated using(true);
create policy "invoices insert" on public.invoices for insert to authenticated with check(true);
create policy "invoices update" on public.invoices for update to authenticated using(true) with check(true);
create policy "payments read" on public.payments for select to authenticated using(true);
create policy "payments insert" on public.payments for insert to authenticated with check(true);
-- No client-facing invite policies: only service role can access invites.
revoke all on public.signup_invites from anon,authenticated;
insert into public.company_settings(id,business_name,issuer_name,state_code) values('00000000-0000-0000-0000-000000000001','MS Management Consulting','MADHU M. S.','29') on conflict(id) do nothing;
