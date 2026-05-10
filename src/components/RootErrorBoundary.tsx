import { CircleAlert, RefreshCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class RootErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("RootErrorBoundary caught an error:", error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex min-h-screen items-center justify-center bg-background px-4 text-center"
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div className="max-w-lg">
            <CircleAlert className="mx-auto mb-4 size-12 text-destructive" />
            <h1 className="text-2xl font-bold">Something went wrong</h1>
            <p className="mt-2 text-muted-foreground">
              An unexpected error occurred. Please reload the page to try again.
            </p>
            {import.meta.env.DEV && this.state.error && (
              <Alert variant="destructive" className="mx-auto mt-4 max-w-md text-left">
                <AlertDescription>
                  <pre className="overflow-auto text-sm">{this.state.error.message}</pre>
                </AlertDescription>
              </Alert>
            )}
            <div className="mt-8">
              <Button onClick={this.handleReload}>
                <RefreshCw className="size-4" />
                Reload Page
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
