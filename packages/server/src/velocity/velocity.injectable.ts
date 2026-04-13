import * as VelocityService from "./velocity.service";

export interface VelocityServiceInterface {
  recordSave(projectId: string): Promise<void>;
  updateDailySnapshot(projectId: string): Promise<void>;
}

let velocityServiceOverride: VelocityServiceInterface | null = null;

/** @internal Test-only: inject a mock velocity service. */
export function setVelocityService(svc: VelocityServiceInterface): void {
  velocityServiceOverride = svc;
}

/** @internal Test-only: clear the velocity service override. */
export function resetVelocityService(): void {
  velocityServiceOverride = null;
}

export function getVelocityService(): VelocityServiceInterface {
  return velocityServiceOverride ?? VelocityService;
}
