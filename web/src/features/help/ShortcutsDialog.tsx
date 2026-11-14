import { Kbd, Modal } from '../../ui'

const SHORTCUTS: [string, string][] = [
  ['Ctrl ↵', 'Start a run'],
  ['Ctrl .', 'Stop the live run'],
  ['J / K', 'Previous / next step'],
  ['Home / End', 'First step / latest step'],
  ['Space', 'Play or pause replay (when focus is not on a control)'],
  ['E', 'Evidence for the current step'],
  ['R', 'Collapse or expand results'],
  ['T', 'Switch theme: system, dark, parchment'],
  ['P', 'Projector mode'],
  ['?', 'This list'],
  ['Esc', 'Close a dialog or drawer'],
]

export function ShortcutsDialog({ onClose }: { onClose(): void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <table className="shortcuts">
        <caption className="sr-only">Keyboard shortcuts</caption>
        <tbody>
          {SHORTCUTS.map(([keys, action]) => (
            <tr key={keys}>
              <th scope="row">
                <Kbd>{keys}</Kbd>
              </th>
              <td>{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Single-key shortcuts are ignored while typing in a field.</p>
    </Modal>
  )
}
