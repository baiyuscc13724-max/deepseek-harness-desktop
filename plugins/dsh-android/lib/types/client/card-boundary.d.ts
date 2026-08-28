/**
 * Last-resort guard around every dsh-android conversation card. A throwing
 * slot component must never take down the conversation, so each registered
 * view is wrapped in this boundary and renders a static fallback card instead.
 */
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
interface AndroidCardBoundaryProps {
    children: ReactNode;
}
interface AndroidCardBoundaryState {
    failed: boolean;
}
export declare class AndroidCardBoundary extends Component<AndroidCardBoundaryProps, AndroidCardBoundaryState> {
    constructor(props: AndroidCardBoundaryProps);
    static getDerivedStateFromError(): AndroidCardBoundaryState;
    componentDidCatch(error: unknown, info: ErrorInfo): void;
    render(): ReactNode;
}
export {};
