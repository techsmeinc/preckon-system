// There is no server in this build.
//
// The two tools reach for `api` in exactly one situation each: the editor's
// "Save to project", and the studio's document save. Both are workspace
// actions, and this app has no workspace — a drawing here comes off the disk
// and goes back to the disk.
//
// So rather than silently resolve and let a save look like it worked, every
// call throws with a sentence saying where the thing actually is. A save that
// quietly does nothing is how a day's markup gets lost.

const OFFLINE =
  "This is the standalone workstation — there is no workspace to save to. " +
  "Use Download DXF to write the drawing back to your disk, or open the same " +
  "drawing in Preckon on the web to save it into a project.";

const refuse = async (): Promise<never> => { throw new Error(OFFLINE); };

export class ApiClientError extends Error {
  constructor(public code: string, message: string, public status: number, public details?: unknown) {
    super(message);
    this.name = "ApiClientError";
  }
}

export const api = {
  get: refuse,
  post: refuse,
  put: refuse,
  patch: refuse,
  del: refuse,
  upload: refuse,
};
