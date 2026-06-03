/**
 * Interactive login flows (browser OAuth2 / password signin).
 *
 * STAGED: the legacy CLIs use Hydra browser OAuth2 with a local callback and an
 * RSA-encrypted `/oauth2/signin` password path. Reimplementing those correctly
 * needs the verified backend contract, so they are intentionally not guessed
 * here. Until then, `auth login --token <t>` covers CI / headless use.
 */
import { InputError } from "../utils/errors.js";

export function browserLogin(_baseUrl: string): never {
  throw new InputError(
    "Browser OAuth2 login is not implemented yet. Use `openbkn auth login <url> --token <token>` for now.",
  );
}

export function passwordLogin(_baseUrl: string, _username: string, _password: string): never {
  throw new InputError(
    "Password signin is not implemented yet. Use `openbkn auth login <url> --token <token>` for now.",
  );
}
