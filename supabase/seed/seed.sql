-- Development/test seed data ONLY. Never run against production (§6.2).
-- Assumes at least one auth user already exists (sign up through the app
-- first — the bootstrap trigger provisions the organization and mandatory
-- channels). This script then fills the workspace with realistic synthetic
-- operational data owned by the first user.

do $$
declare
  v_org uuid;
  v_user uuid;
  v_program uuid;
  v_program2 uuid;
  v_project uuid;
  v_project2 uuid;
  v_channel uuid;
  v_milestone uuid;
  v_crm uuid;
  v_meeting uuid;
begin
  select id into v_org from organization limit 1;
  select user_id into v_user from organization_membership
    where organization_id = v_org and role = 'owner' limit 1;

  if v_org is null or v_user is null then
    raise exception 'Sign up through the app first so the bootstrap trigger can provision the workspace.';
  end if;

  -- Programs
  insert into program (organization_id, name, slug, description, lead_id, created_by)
  values
    (v_org, 'Family First', 'family-first', 'Family and community education support services.', v_user, v_user),
    (v_org, 'Tutoring & Mentorship', 'tutoring-mentorship', 'After-school tutoring and mentorship programming.', v_user, v_user)
  returning id into v_program;
  select id into v_program2 from program where slug = 'tutoring-mentorship';

  -- Projects
  insert into project (organization_id, program_id, name, outcome, owner_id, stage, health, start_date, target_date, created_by)
  values
    (v_org, v_program, 'Fall Community Workshop Series', 'Deliver six community workshops with 80% attendance satisfaction.', v_user, 'active', 'on_track', current_date - 30, current_date + 60, v_user),
    (v_org, v_program2, 'Tutor Recruitment Drive', 'Recruit and onboard 25 qualified volunteer tutors before the winter term.', v_user, 'active', 'at_risk', current_date - 14, current_date + 30, v_user)
  returning id into v_project;
  select id into v_project2 from project where name = 'Tutor Recruitment Drive';

  update project set health_reason = 'Applications are below target; outreach expansion planned.'
    where id = v_project2;

  insert into project_membership (project_id, user_id, role)
  values (v_project, v_user, 'manager'), (v_project2, v_user, 'manager');

  -- Milestones
  insert into milestone (project_id, name, due_date, sort_key)
  values
    (v_project, 'Venue and speakers confirmed', current_date + 7, 1),
    (v_project, 'Registration open', current_date + 21, 2),
    (v_project2, 'Outreach campaign launched', current_date + 5, 1)
  returning id into v_milestone;

  -- Tasks
  insert into task (organization_id, program_id, project_id, title, description, status, priority, assignee_id, due_at, created_by, sort_key)
  values
    (v_org, v_program, v_project, 'Confirm workshop venue contract', 'Sign the facility agreement for all six sessions.', 'in_progress', 'high', v_user, current_date + 3, v_user, 1),
    (v_org, v_program, v_project, 'Draft registration form', 'Create the registration form and confirmation email copy.', 'ready', 'medium', v_user, current_date + 10, v_user, 2),
    (v_org, v_program, v_project, 'Prepare facilitator briefing pack', null, 'not_started', 'medium', v_user, current_date + 14, v_user, 3),
    (v_org, v_program2, v_project2, 'Publish tutor recruitment page', 'Landing page with role description and application form.', 'in_review', 'high', v_user, current_date + 2, v_user, 1),
    (v_org, v_program2, v_project2, 'Contact university partnership offices', null, 'not_started', 'critical', v_user, current_date + 1, v_user, 2),
    (v_org, null, null, 'Prepare board meeting materials', 'Quarterly packet for the board.', 'in_progress', 'high', v_user, current_date + 5, v_user, 1);

  -- Project status update
  insert into project_status_update (project_id, author_id, health, progress_summary, next_steps, blockers)
  values (v_project, v_user, 'on_track',
          'Three of six venues confirmed; speaker outreach 70% complete.',
          'Finalize remaining venues and open registration.',
          null);

  -- Program/project channel
  insert into channel (organization_id, name, slug, type, privacy, purpose, project_id, owner_id, created_by)
  values (v_org, 'Fall Workshop Series', 'project-fall-workshops', 'project', 'public',
          'Coordination for the Fall Community Workshop Series.', v_project, v_user, v_user)
  returning id into v_channel;

  insert into channel_member (channel_id, user_id, role, membership_source)
  values (v_channel, v_user, 'manager', 'project');

  insert into message (organization_id, channel_id, author_id, body)
  values
    (v_org, v_channel, v_user, 'Welcome to the workshop series channel. Venue updates land here first.'),
    (v_org, v_channel, v_user, 'Reminder: facilitator briefing pack drafts are due Friday.');

  -- Announcement in the mandatory channel
  insert into message (organization_id, channel_id, author_id, body)
  select v_org, c.id, v_user,
         'Welcome to QBBE Hub — our internal operating and communication system. Please review your My Work page and update task statuses weekly.'
  from channel c where c.organization_id = v_org and c.slug = 'announcements';

  insert into announcement (message_id, organization_id, title, priority, requires_ack, ack_deadline, created_by)
  select m.id, v_org, 'Welcome to QBBE Hub', 'important', true, now() + interval '7 days', v_user
  from message m
  join channel c on c.id = m.channel_id
  where c.slug = 'announcements'
  order by m.created_at desc limit 1;

  -- Meeting with agenda
  insert into meeting (organization_id, project_id, title, purpose, organizer_id, starts_at, ends_at, status)
  values (v_org, v_project, 'Workshop series weekly sync', 'Review venue confirmations and registration readiness.',
          v_user, date_trunc('hour', now()) + interval '2 days', date_trunc('hour', now()) + interval '2 days 1 hour', 'scheduled')
  returning id into v_meeting;

  insert into meeting_attendee (meeting_id, user_id) values (v_meeting, v_user);
  insert into agenda_item (meeting_id, title, kind, owner_id, time_box_minutes, sort_key, status, proposed_by)
  values
    (v_meeting, 'Venue confirmation status', 'information', v_user, 10, 1, 'accepted', v_user),
    (v_meeting, 'Registration platform decision', 'decision', v_user, 20, 2, 'accepted', v_user);

  -- Event
  insert into event (organization_id, program_id, project_id, name, description, owner_id, event_type, starts_at, ends_at, location, status, volunteer_need, created_by)
  values (v_org, v_program, v_project, 'Community Workshop #1', 'First session of the fall series.', v_user, 'workshop',
          now() + interval '21 days', now() + interval '21 days 3 hours', 'Community Center — Hall B', 'planning', 6, v_user);

  -- CRM
  insert into crm_organization (organization_id, name, category, owner_id, created_by)
  values
    (v_org, 'Fondation Horizon', 'funder', v_user, v_user),
    (v_org, 'McGill University — Faculty of Education', 'university', v_user, v_user)
  returning id into v_crm;

  insert into crm_contact (organization_id, crm_organization_id, full_name, role_title, email, owner_id)
  values (v_org, v_crm, 'Program Officer (seed contact)', 'Program Officer', 'contact@example.org', v_user);

  insert into crm_follow_up (organization_id, crm_organization_id, owner_id, title, due_at)
  values (v_org, v_crm, v_user, 'Send Q3 impact summary', current_date + 7);

  -- Activity
  insert into activity_event (organization_id, actor_id, verb, source_type, source_id, project_id, summary)
  values (v_org, v_user, 'created', 'project', v_project, v_project, 'created project “Fall Community Workshop Series”');
end;
$$;
