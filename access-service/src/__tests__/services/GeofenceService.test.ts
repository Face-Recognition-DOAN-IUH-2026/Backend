import {
  calculateDistance,
  isWithinGeofence,
  validatePatronEntry,
} from '../../services/GeofenceService';

describe('GeofenceService', () => {
  describe('Gap 12: Geofence Patron Entry', () => {
    describe('calculateDistance', () => {
      it('should calculate distance between two points correctly', () => {
        const lat1 = 10.7769;
        const lng1 = 106.6953;
        const lat2 = 10.7770;
        const lng2 = 106.6954;

        const distance = calculateDistance(lat1, lng1, lat2, lng2);
        expect(distance).toBeGreaterThan(0);
        expect(distance).toBeLessThan(1000);
      });

      it('should return 0 for same coordinates', () => {
        const lat = 10.7769;
        const lng = 106.6953;

        const distance = calculateDistance(lat, lng, lat, lng);
        expect(distance).toBe(0);
      });
    });

    describe('isWithinGeofence', () => {
      it('should return true for coordinates within geofence', () => {
        const patronLat = 10.7769;
        const patronLng = 106.6953;

        const result = isWithinGeofence(patronLat, patronLng, {
          centerLat: 10.7769,
          centerLng: 106.6953,
          radiusMeters: 100,
        });

        expect(result).toBe(true);
      });

      it('should return false for coordinates outside geofence', () => {
        const patronLat = 10.8;
        const patronLng = 106.7;

        const result = isWithinGeofence(patronLat, patronLng, {
          centerLat: 10.7769,
          centerLng: 106.6953,
          radiusMeters: 100,
        });

        expect(result).toBe(false);
      });

      it('should use default geofence config when not provided', () => {
        const patronLat = 10.7769;
        const patronLng = 106.6953;

        const result = isWithinGeofence(patronLat, patronLng);
        expect(typeof result).toBe('boolean');
      });
    });

    describe('validatePatronEntry', () => {
      it('should allow entry when patron is within geofence', () => {
        const patronLat = 10.7769;
        const patronLng = 106.6953;

        const result = validatePatronEntry(patronLat, patronLng, {
          centerLat: 10.7769,
          centerLng: 106.6953,
          radiusMeters: 100,
        });

        expect(result.allowed).toBe(true);
        expect(result.distance).toBeLessThanOrEqual(100);
        expect(result.reason).toContain('within');
      });

      it('should deny entry when patron is outside geofence', () => {
        const patronLat = 10.8;
        const patronLng = 106.7;

        const result = validatePatronEntry(patronLat, patronLng, {
          centerLat: 10.7769,
          centerLng: 106.6953,
          radiusMeters: 100,
        });

        expect(result.allowed).toBe(false);
        expect(result.distance).toBeGreaterThan(100);
        expect(result.reason).toContain('outside');
      });

      it('should return distance in result', () => {
        const patronLat = 10.7770;
        const patronLng = 106.6954;

        const result = validatePatronEntry(patronLat, patronLng, {
          centerLat: 10.7769,
          centerLng: 106.6953,
          radiusMeters: 100,
        });

        expect(typeof result.distance).toBe('number');
        expect(result.distance).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
