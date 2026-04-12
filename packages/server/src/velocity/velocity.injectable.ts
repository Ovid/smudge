import * as VelocityService from "./velocity.service";

export interface VelocityServiceInterface {
  recordSave(projectId: string): Promise<void>;
  updateDailySnapshot(projectId: string): Promise<void>;
}

let velocityServiceOverride: VelocityServiceInterface | null = null;

export function setVelocityService(svc: VelocityServiceInterface): void {
  velocityServiceOverride = svc;
}

export function resetVelocityService(): void {
  velocityServiceOverride = null;
}

export function getVelocityService(): VelocityServiceInterface {
  return velocityServiceOverride ?? VelocityService;
}
