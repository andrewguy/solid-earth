import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** Rendered instead of the children after an error; `reset` tries the children again. */
  readonly fallback: (error: Error, reset: () => void) => ReactNode
  readonly children: ReactNode
}

interface State {
  readonly error: Error | null
}

/**
 * Contains a render error to one part of the app instead of unmounting everything. (React only
 * supports error boundaries as class components.)
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Contained by ErrorBoundary:', error, info.componentStack)
  }

  private readonly reset = () => this.setState({ error: null })

  override render(): ReactNode {
    return this.state.error
      ? this.props.fallback(this.state.error, this.reset)
      : this.props.children
  }
}
