export class CommandStack {
  constructor() { this.done = []; this.undone = []; }
  execute(cmd) { cmd.do(); this.done.push(cmd); this.undone = []; }
  undo() { const c = this.done.pop(); if (c) { c.undo(); this.undone.push(c); } }
  redo() { const c = this.undone.pop(); if (c) { c.do(); this.done.push(c); } }
  get canUndo() { return this.done.length > 0; } get canRedo() { return this.undone.length > 0; }
}
