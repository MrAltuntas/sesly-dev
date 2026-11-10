"use client";

import { Component, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("Error caught by boundary:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                this.props.fallback || (
                    <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
                        <div className="p-4 bg-destructive/10 rounded-full mb-4">
                            <AlertTriangle className="w-12 h-12 text-destructive" />
                        </div>
                        <h2 className="text-2xl font-bold mb-2">Something went wrong</h2>
                        <p className="text-muted-foreground mb-6 max-w-md">
                            {this.state.error?.message || "An unexpected error occurred"}
                        </p>
                        <button
                            onClick={() => this.setState({ hasError: false })}
                            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
                        >
                            Try Again
                        </button>
                    </div>
                )
            );
        }

        return this.props.children;
    }
}
