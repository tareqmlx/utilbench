import { type ScrubbedError, pushError } from "@/lib/errorReport";
import { CircleAlert, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ReportIssueButton } from "./ReportIssueButton";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  reportError: ScrubbedError | null;
}

export class ToolErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, reportError: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ToolErrorBoundary caught an error:", error, info);
    // Capture the exact scrubbed error so a later window.onerror/rejection can't
    // overwrite what the Report button sends.
    this.setState({ reportError: pushError(error, { source: "ToolErrorBoundary" }) });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, reportError: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto max-w-lg px-4 py-24 text-center">
          <CircleAlert className="mx-auto mb-4 size-12 text-destructive" />
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          {import.meta.env.DEV && this.state.error && (
            <Alert variant="destructive" className="mx-auto mt-4 max-w-md text-left">
              <AlertDescription>
                <pre className="overflow-auto text-sm">{this.state.error.message}</pre>
              </AlertDescription>
            </Alert>
          )}
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button onClick={this.handleRetry}>
              <RotateCcw className="size-4" />
              Retry
            </Button>
            <Button variant="outline" asChild>
              <Link to="/tools">Browse all tools</Link>
            </Button>
            <ReportIssueButton variant="error" error={this.state.reportError} />
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
