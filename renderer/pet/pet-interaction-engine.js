(function exposePetInteraction(globalObject) {
  'use strict'

  class PetInteractionEngine {
    constructor({ dragDistance = 8, petHoldMs = 280, petGraceDistance = 38, onEvent = () => {} } = {}) {
      this.dragDistance = dragDistance
      this.petHoldMs = petHoldMs
      this.petGraceDistance = petGraceDistance
      this.onEvent = onEvent
      this.gesture = null
    }

    begin(point) {
      if (!point || point.pointerId == null) return false
      this.gesture = {
        pointerId: point.pointerId,
        originX: point.x,
        originY: point.y,
        lastX: point.x,
        lastY: point.y,
        startedAt: point.at,
        hotspot: point.hotspot || 'body',
        mode: 'pending'
      }
      this.onEvent({ type: 'press', ...this.gesture })
      return true
    }

    hold(point) {
      const gesture = this.gesture
      if (!gesture || gesture.mode !== 'pending') return false
      const elapsed = point.at - gesture.startedAt
      const distance = Math.hypot(point.x - gesture.originX, point.y - gesture.originY)
      if (gesture.hotspot !== 'head' || elapsed < this.petHoldMs || distance > this.petGraceDistance) return false
      gesture.mode = 'petting'
      gesture.lastX = point.x
      gesture.lastY = point.y
      this.onEvent({ type: 'pet-start', ...gesture, elapsed, distance })
      return true
    }

    move(point) {
      const gesture = this.gesture
      if (!gesture || point.pointerId !== gesture.pointerId) return null
      const elapsed = point.at - gesture.startedAt
      const distance = Math.hypot(point.x - gesture.originX, point.y - gesture.originY)
      const previousX = gesture.lastX
      const previousY = gesture.lastY
      gesture.lastX = point.x
      gesture.lastY = point.y

      if (gesture.mode === 'pending') {
        if (gesture.hotspot === 'head' && elapsed >= this.petHoldMs && distance <= this.petGraceDistance) {
          gesture.mode = 'petting'
          this.onEvent({ type: 'pet-start', ...gesture, elapsed, distance })
        } else if (distance >= this.dragDistance) {
          gesture.mode = 'dragging'
          this.onEvent({ type: 'drag-start', ...gesture, elapsed, distance })
        }
      } else if (gesture.mode === 'petting') {
        const stillPetting = point.hotspot === 'head' && distance <= this.petGraceDistance
        if (!stillPetting) {
          gesture.mode = 'dragging'
          this.onEvent({ type: 'drag-start', ...gesture, elapsed, distance, fromPetting: true })
        } else {
          this.onEvent({ type: 'pet-move', ...gesture, deltaX: point.x - previousX, deltaY: point.y - previousY })
        }
      } else if (gesture.mode === 'dragging') {
        this.onEvent({ type: 'drag-move', ...gesture, deltaX: point.x - previousX, deltaY: point.y - previousY })
      }
      return gesture.mode
    }

    end(point) {
      const gesture = this.gesture
      if (!gesture || point.pointerId !== gesture.pointerId) return null
      gesture.lastX = point.x
      gesture.lastY = point.y
      const elapsed = point.at - gesture.startedAt
      const distance = Math.hypot(point.x - gesture.originX, point.y - gesture.originY)
      const mode = gesture.mode
      this.gesture = null
      const type = mode === 'dragging' ? 'drag-end' : mode === 'petting' ? 'pet-end' : 'tap'
      const result = { type, ...gesture, elapsed, distance, hotspot: point.hotspot || gesture.hotspot }
      this.onEvent(result)
      return result
    }

    cancel() {
      const gesture = this.gesture
      this.gesture = null
      if (!gesture) return null
      const result = { type: 'cancel', ...gesture }
      this.onEvent(result)
      return result
    }
  }

  const exported = { PetInteractionEngine }
  if (typeof module !== 'undefined' && module.exports) module.exports = exported
  globalObject.MaidWhaleInteraction = exported
})(typeof window === 'undefined' ? globalThis : window)
