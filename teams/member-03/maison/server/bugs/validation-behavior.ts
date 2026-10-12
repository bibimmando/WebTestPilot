import { isOn } from "./index";

/** BUG-002, historical V6 → V2: storage still trims the accepted raw name. */
export function accountNameForValidation(name: string): string {
  return isOn("V2") ? name : name.trim();
}

/** BUG-003, historical V11 → V5: only signup rejects the valid boundary. */
export function rejectsSignupPassword(password: string): boolean {
  return isOn("V5") ? password.length <= 8 : password.length < 8;
}
