import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

// autenticacao nao foi implementada (ver ARCHITECTURE.md).
// aqui entraria a validacao do token do provedor (Keycloak/OIDC)
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
