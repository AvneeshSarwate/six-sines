/** One selected physical input; channel messages only, never MIDI outputs or SysEx. */
export class MidiInput {
  access?: MIDIAccess
  selected?: MIDIInput
  channel = -1
  private receive: (bytes: Uint8Array) => void
  private panic: () => void
  private changed: () => void
  constructor(receive: (bytes: Uint8Array) => void, panic: () => void, changed: () => void) { this.receive = receive; this.panic = panic; this.changed = changed }
  async enable() {
    if (!navigator.requestMIDIAccess) throw new Error('Web MIDI is unavailable here. Use a browser with Web MIDI support on localhost or HTTPS.')
    this.access ??= await navigator.requestMIDIAccess({ sysex: false })
    this.access.onstatechange = () => {
      if (this.selected?.state === 'disconnected') { this.panic(); this.selected.onmidimessage = null; this.selected = undefined }
      this.changed()
    }
    this.changed()
  }
  async select(id: string) {
    this.panic()
    if (this.selected) { this.selected.onmidimessage = null; void this.selected.close() }
    this.selected = undefined
    const input = this.access?.inputs.get(id)
    if (input) {
      await input.open()
      this.selected = input
      input.onmidimessage = event => {
        const bytes = event.data
        if (bytes && bytes[0]! >= 0x80 && bytes[0]! < 0xf0 && (this.channel === -1 || (bytes[0]! & 15) === this.channel)) this.receive(bytes)
      }
    }
    this.changed()
  }
  setChannel(channel: number) { this.panic(); this.channel = channel }
  dispose() {
    if (this.access) this.access.onstatechange = null
    if (this.selected) { this.selected.onmidimessage = null; void this.selected.close() }
    this.panic()
  }
}
