-- A data export for one CRM contact (donor, funder, partner), alongside the
-- one for a person. On its own because a new enum value cannot be used in the
-- transaction that adds it; 20261121130100_contact_data_export uses it.
alter type public.export_kind add value if not exists 'contact_data';
