-- A coller dans Supabase (Project > SQL Editor > New query > Run).
-- Table utilisee par la section /nutrition (voir CLAUDE.md).

create table if not exists nutrition_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  calories_kcal numeric,
  protein_g numeric,
  carbohydrates_g numeric,
  sugars_g numeric,
  fat_g numeric,
  saturated_fat_g numeric,
  fiber_g numeric,
  salt_g numeric,
  serving_size text,
  vitamins_minerals jsonb,
  created_at timestamptz not null default now()
);
