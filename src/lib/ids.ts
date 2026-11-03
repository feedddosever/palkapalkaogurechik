import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const nano = customAlphabet(alphabet, 16);

export type IdPrefix =
  | "ws"
  | "biz"
  | "agt"
  | "man"
  | "cyc"
  | "sup"
  | "pay"
  | "inv"
  | "msg"
  | "req"
  | "gd"
  | "apr"
  | "ppo"
  | "rcp"
  | "run"
  | "tre"
  | "whk"
  | "lab"
  | "plant";

/** Prefixed, URL-safe, lowercase id, e.g. `req_3k9x…`. */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${nano()}`;
}
