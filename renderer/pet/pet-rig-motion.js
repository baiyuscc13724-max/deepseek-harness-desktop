(function exposeRigMotion(globalObject) {
  'use strict'

  const TAU = Math.PI * 2

  function neutralPose() {
    return {
      rootY: 0,
      rootRotation: 0,
      rootScaleX: 1,
      rootScaleY: 1,
      torsoRotation: 0,
      headRotation: 0,
      armLeftUpper: .08,
      armLeftLower: -.12,
      armRightUpper: -.08,
      armRightLower: .12,
      legLeft: 0,
      legRight: 0,
      tailBase: .08,
      tailTip: -.12,
      hairRotation: 0
    }
  }

  function rigPose(action = 'idle', seconds = 0) {
    const pose = neutralPose()
    const slow = Math.sin(seconds * TAU / 3.2)
    if (action === 'idle' || action === 'sit') {
      pose.rootY = slow * 2.2
      pose.rootScaleY = 1 + slow * .006
      pose.headRotation = Math.sin(seconds * 1.5) * .018
      pose.tailBase = .08 + Math.sin(seconds * 2.1) * .09
      pose.tailTip = -.12 + Math.sin(seconds * 2.1 + .7) * .13
      pose.hairRotation = -Math.sin(seconds * 1.7) * .018
    } else if (action === 'walk') {
      const stride = Math.sin(seconds * TAU * 2.2)
      const step = Math.abs(Math.cos(seconds * TAU * 2.2))
      pose.rootY = -step * 5
      pose.rootRotation = stride * .018
      pose.torsoRotation = -stride * .025
      pose.headRotation = stride * .018
      pose.legLeft = stride * .28
      pose.legRight = -stride * .28
      pose.armLeftUpper = -stride * .18
      pose.armRightUpper = stride * .18
      pose.tailBase = .12 - stride * .18
      pose.tailTip = -.1 - stride * .23
      pose.hairRotation = -stride * .045
    } else if (action === 'drag') {
      pose.rootY = 5 + Math.sin(seconds * 5) * 2
      pose.rootRotation = Math.sin(seconds * 4) * .08
      pose.armLeftUpper = -2.3
      pose.armRightUpper = 2.3
      pose.armLeftLower = -.35
      pose.armRightLower = .35
      pose.legLeft = -.12 + Math.sin(seconds * 3) * .06
      pose.legRight = .12 - Math.sin(seconds * 3) * .06
      pose.tailBase = .28 + Math.sin(seconds * 3) * .12
      pose.tailTip = -.3 + Math.sin(seconds * 3 + .8) * .16
    } else if (action === 'fall') {
      pose.rootRotation = seconds * 4.4
      pose.armLeftUpper = -1.8
      pose.armRightUpper = 1.8
      pose.legLeft = -.25
      pose.legRight = .25
      pose.tailBase = .45
      pose.tailTip = -.5
    } else if (action === 'land') {
      const impact = Math.max(0, 1 - seconds * 2.2)
      pose.rootY = 8 * impact
      pose.rootScaleX = 1 + .12 * impact
      pose.rootScaleY = 1 - .16 * impact
      pose.legLeft = -.12
      pose.legRight = .12
    } else if (action === 'working') {
      const work = Math.sin(seconds * TAU * 1.5)
      pose.rootY = -Math.abs(work) * 2
      pose.headRotation = work * .025
      pose.armLeftUpper = -.45 + work * .08
      pose.armRightUpper = .45 - work * .08
      pose.armLeftLower = -1.05 + work * .16
      pose.armRightLower = 1.05 - work * .16
      pose.tailBase = .05 + work * .04
    } else if (action === 'needs-input' || action === 'wave') {
      pose.armRightUpper = 2.2 + Math.sin(seconds * 9) * .18
      pose.armRightLower = .25 + Math.sin(seconds * 9) * .2
      pose.headRotation = -.06
      pose.tailBase = .18 + Math.sin(seconds * 5) * .12
    } else if (action === 'feeding') {
      const chew = Math.sin(seconds * TAU * 3)
      pose.rootScaleX = 1 + chew * .018
      pose.rootScaleY = 1 - chew * .014
      pose.headRotation = chew * .025
      pose.armLeftLower = -.8
      pose.armRightLower = .8
    } else if (action === 'celebrating' || action === 'ready') {
      const dance = Math.sin(seconds * TAU * 2)
      pose.rootY = -Math.abs(Math.cos(seconds * TAU * 2)) * 8
      pose.rootRotation = dance * .1
      pose.armLeftUpper = -2.1 - dance * .2
      pose.armRightUpper = 2.1 + dance * .2
      pose.legLeft = dance * .18
      pose.legRight = -dance * .18
      pose.tailBase = .2 + dance * .2
      pose.tailTip = -.2 + dance * .26
    } else if (action === 'sleeping' || action === 'hungry' || action === 'blocked') {
      pose.rootY = 10 + slow * 1.5
      pose.rootRotation = .08
      pose.rootScaleY = .94
      pose.headRotation = .1
      pose.tailBase = -.05 + slow * .03
      pose.tailTip = -.2
    }
    return pose
  }

  const exported = { neutralPose, rigPose }
  if (typeof module !== 'undefined' && module.exports) module.exports = exported
  globalObject.MaidWhaleRigMotion = exported
})(typeof window === 'undefined' ? globalThis : window)
