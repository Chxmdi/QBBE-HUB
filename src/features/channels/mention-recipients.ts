export type MentionMember = { userId: string; fullName: string };
export type MentionTeam = { id: string; name: string };
export type TeamMember = { teamId: string; userId: string };

/** Resolves exact @person and @team tokens, then intersects them with the
 * message audience. This prevents notification metadata from leaking a
 * private-channel message to an otherwise unrelated organization member. */
export function mentionRecipientIds(input: {
  body: string;
  authorId: string;
  eligibleUserIds: Iterable<string>;
  members: MentionMember[];
  teams: MentionTeam[];
  teamMembers: TeamMember[];
}): string[] {
  const body = input.body.toLocaleLowerCase();
  const eligible = new Set(input.eligibleUserIds);
  const ids = new Set<string>();
  for (const member of input.members) {
    if (body.includes(`@${member.fullName.toLocaleLowerCase()}`)) ids.add(member.userId);
  }
  const matchedTeams = new Set(
    input.teams.filter((team) => body.includes(`@${team.name.toLocaleLowerCase()}`)).map((team) => team.id),
  );
  for (const member of input.teamMembers) if (matchedTeams.has(member.teamId)) ids.add(member.userId);
  return [...ids].filter((id) => id !== input.authorId && eligible.has(id));
}
