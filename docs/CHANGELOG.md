# Changes people will notice

Behaviour changes worth telling staff and administrators about, newest
first. Fixes that only make something work as it always claimed to are not
listed.

## Unreleased

- **Closing a project with evidence from another project is refused.** If one
  of the documents chosen as closure evidence is filed under a different
  project, the close now stops and says so, and nothing changes. Before, the
  project closed and that document was silently left out of the evidence.
- **Saving a project, program or meeting is all or nothing.** A new project
  always comes with its manager and (for staff) its channel, a meeting series
  with its attendees and agenda, and a closed project with its final update,
  closure record and evidence. Two projects with the same name now each get
  their own channel.
- **A save that cannot reach the Hub says so.** Buttons no longer stay on
  "Saving…" when the connection drops; they come back with a message, and a
  page opened before a release reloads itself.
- **Blocked uploads explain themselves.** A file the virus scanner blocks now
  says why (password-protected, a virus, too large). Administrators can
  release a password-protected PDF they have checked, or delete a blocked
  file, from Admin → Jobs → Blocked files.
- **Failed email is retried for about four hours**, and an administrator can
  send the last week's failed email again from Admin → Jobs.
- **Exports refuse to download when they cannot be recorded.** A personal or
  financial data export stops, with a message, if the record of who
  downloaded it cannot be saved.
