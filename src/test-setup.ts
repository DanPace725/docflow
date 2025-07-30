// Polyfill for PointerEvent
if (!global.PointerEvent) {
  class PointerEvent extends MouseEvent {
    constructor(type, params) {
      super(type, params);
    }
  }
  global.PointerEvent = PointerEvent;
}

// Polyfill for hasPointerCapture
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = function(pointerId) {
    return false;
  };
}

// Polyfill for releasePointerCapture
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = function(pointerId) {
    // No-op
  };
}

// Polyfill for scrollIntoView
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function() {
    // No-op
  };
}
