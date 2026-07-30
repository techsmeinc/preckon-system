/**
 * External integrations, stubbed for local/dev. Real providers plug in behind
 * these interfaces without touching call sites (§X). With no live provider the
 * send is logged to the server console.
 */
export const email = {
  async send(msg: { to: string; subject: string; body: string }): Promise<void> {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[email] to=${msg.to} subject="${msg.subject}"\n${msg.body}`);
    }
  },
};
