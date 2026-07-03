export interface GeofenceConfig {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
}

const DEFAULT_GEOFENCE: GeofenceConfig = {
  centerLat: 10.7769,
  centerLng: 106.6953,
  radiusMeters: 100,
};

const distanceCache = new Map<string, number>();
const CACHE_MAX = 5000;

function cacheKey(lat1: number, lng1: number, lat2: number, lng2: number): string {
  return `${lat1.toFixed(6)},${lng1.toFixed(6)}|${lat2.toFixed(6)},${lng2.toFixed(6)}`;
}

export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const key = cacheKey(lat1, lng1, lat2, lng2);
  const cached = distanceCache.get(key);
  if (cached !== undefined) return cached;

  const R = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distance = R * c;

  if (distanceCache.size >= CACHE_MAX) {
    const firstKey = distanceCache.keys().next().value;
    if (firstKey) distanceCache.delete(firstKey);
  }
  distanceCache.set(key, distance);

  return distance;
}

export function isWithinGeofence(
  patronLat: number,
  patronLng: number,
  config: GeofenceConfig = DEFAULT_GEOFENCE
): boolean {
  const distance = calculateDistance(
    patronLat,
    patronLng,
    config.centerLat,
    config.centerLng
  );
  return distance <= config.radiusMeters;
}

export function validatePatronEntry(
  patronLat: number,
  patronLng: number,
  config: GeofenceConfig = DEFAULT_GEOFENCE
): { allowed: boolean; distance: number; reason: string } {
  const distance = calculateDistance(
    patronLat,
    patronLng,
    config.centerLat,
    config.centerLng
  );

  if (distance <= config.radiusMeters) {
    return {
      allowed: true,
      distance,
      reason: 'Patron is within the library geofence',
    };
  }

  return {
    allowed: false,
    distance,
    reason: `Patron is ${Math.round(distance - config.radiusMeters)}m outside the library geofence`,
  };
}
