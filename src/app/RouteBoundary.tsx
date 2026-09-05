import { Component, type ReactNode } from 'react'
import { Button, StatePanel } from '../components/ui'

export class RouteBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  render() {
    if (this.state.failed) return <StatePanel title="画面を読み込めませんでした" tone="danger" role="alert" action={<Button onClick={() => window.location.reload()}>再読み込み</Button>} />
    return this.props.children
  }
}
