// Chapter 0: welcome and signing in. Everyone.
export default {
  id: "00-welcome",
  title: "Welcome and signing in",
  audience: "Everyone",
  async run(d) {
    await d.go("/sign-in");
    await d.title("QBBE Hub · Chapter 0", "Welcome and signing in", "Your first minutes in the Hub");

    await d.say("Welcome to the QBBE Hub, the one place for the organization's work: tasks, projects, meetings, documents, money and people.");
    await d.say("You start with the invitation email. It opens this sign-in page. Type the email address the invitation was sent to, then the password you chose.");
    await d.signIn("staff");
    await d.say("Administrators are asked for a six-digit code from their phone's authenticator app on every sign-in. Everyone else signs in with email and password.");
    await d.say("This is Home. It shows what needs you today: tasks due, meetings coming up, messages and approvals waiting.");
    await d.highlight(d.page.getByRole("navigation").first());
    await d.say("The sidebar on the left is the map of the Hub. We will visit each area in the chapters that follow.");
    await d.hover(d.page.getByRole("link", { name: "Projects", exact: true }));
    await d.say("Hover any entry to see where it leads; the arrow keys and Enter work too, so the whole Hub can be used from the keyboard.");
  },
};
