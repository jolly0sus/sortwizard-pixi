// The board's silhouette used to be a traced half-width table that this
// editor adjusted point by point. The board is now the original's own
// FramePurpleRender texture, so there is no contour left to edit; the class
// survives as a stub so the panel's toggle keeps working.
export class ProfileEditor {
  constructor() {
    this.enabled = false;
  }

  setEnabled() {
    this.enabled = false;
  }

  destroy() {}
}
