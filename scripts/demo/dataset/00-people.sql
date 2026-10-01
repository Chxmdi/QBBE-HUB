-- The QA accounts as people a new member would recognise on screen. The
-- sign-in addresses do not change (qa-<account>@example.com); only what the Hub
-- shows for each of them. See DATASET.md.
with people(id, full_name, title) as (
  values
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid, 'Danielle Pierre', 'Executive Director'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4'::uuid, 'Marc-André Joseph', 'Operations Manager'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'::uuid, 'Keisha Bernard', 'Program Coordinator'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6'::uuid, 'Jean-Philippe Étienne', 'Program Lead, Youth'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7'::uuid, 'Amara Diallo', 'Project Manager'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3'::uuid, 'Samuel Okafor', 'Volunteer tutor'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8'::uuid, 'Rosalie Charles', 'Volunteer, events'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9'::uuid, 'Nadège Toussaint', 'Board observer'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5'::uuid, 'Omar Benali', 'Partner, Centre Afrika')
)
update public.user_profile p
set full_name = people.full_name,
    title = people.title,
    timezone = 'America/Toronto',
    onboarded_at = coalesce(p.onboarded_at, now() - interval '40 days')
from people
where p.id = people.id;

update auth.users u
set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', p.full_name)
from public.user_profile p
where p.id = u.id and p.full_name <> coalesce(u.raw_user_meta_data->>'full_name', '');
