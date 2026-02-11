import { nanoid } from 'nanoid';

export function generateId(size = 21): string {
  return nanoid(size);
}

export function generateCheckId(): string {
  return nanoid(12);
}

export function generateToken(): string {
  return nanoid(64);
}

export function generateSessionId(): string {
  return nanoid(32);
}
