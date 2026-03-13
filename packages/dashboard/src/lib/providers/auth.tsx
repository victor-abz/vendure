import { LS_KEY_SELECTED_CHANNEL_TOKEN } from '@/vdb/constants.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql, ResultOf } from '@/vdb/graphql/graphql.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

/**
 * @description
 * Provides information about the current user & their authentication & authorization
 * status.
 *
 * @docsCategory hooks
 * @docsPage useAuth
 * @since 3.3.0
 */
export interface AuthContext {
    /**
     * @description
     * The status of the authentication.
     */
    status: 'initial' | 'authenticated' | 'verifying' | 'unauthenticated';
    /**
     * @description
     * The error message if the authentication fails.
     */
    authenticationError?: string;
    /**
     * @description
     * Whether the user is authenticated.
     */
    isAuthenticated: boolean;
    /**
     * @description
     * The function to login the user.
     */
    login: (username: string, password: string, onSuccess?: () => void) => void;
    /**
     * @description
     * The function to logout the user.
     */
    logout: (onSuccess?: () => void) => Promise<void>;
    /**
     * @description
     * The user object.
     */
    user: ResultOf<typeof CurrentUserQuery>['activeAdministrator'] | undefined;
    /**
     * @description
     * The channels object.
     */
    channels: NonNullable<ResultOf<typeof CurrentUserQuery>['me']>['channels'] | undefined;
    /**
     * @description
     * The function to refresh the current user.
     */
    refreshCurrentUser: () => void;
}

const LoginMutation = graphql(`
    mutation Login($username: String!, $password: String!) {
        login(username: $username, password: $password) {
            __typename
            ... on CurrentUser {
                id
                identifier
            }
            ... on ErrorResult {
                message
                errorCode
            }
        }
    }
`);

const LogOutMutation = graphql(`
    mutation LogOut {
        logout {
            success
        }
    }
`);

const CurrentUserQuery = graphql(`
    query CurrentUserInformation {
        me {
            id
            identifier
            channels {
                id
                token
                code
                permissions
            }
        }
        activeAdministrator {
            id
            firstName
            lastName
            emailAddress
        }
    }
`);

export const AuthContext = React.createContext<AuthContext | null>(null);

export function AuthProvider({ children }: Readonly<{ children: React.ReactNode }>) {
    const [status, setStatus] = React.useState<AuthContext['status']>('initial');
    const [authenticationError, setAuthenticationError] = React.useState<string | undefined>();
    const [isLoginLogoutInProgress, setIsLoginLogoutInProgress] = React.useState(false);
    const { settings, setActiveChannelId } = useUserSettings();
    const queryClient = useQueryClient();

    // Query for current user
    const {
        data: currentUserData,
        isLoading,
        error: currentUserError,
        refetch: refetchCurrentUser,
    } = useQuery({
        queryKey: ['currentUser'],
        queryFn: () => {
            return api.query(CurrentUserQuery);
        },
        retry: false, // Disable retries to avoid waiting for multiple attempts
    });

    // Set active channel if needed
    React.useEffect(() => {
        if (!settings.activeChannelId && currentUserData?.me?.channels?.length) {
            setActiveChannelId(currentUserData.me.channels[0].id);
        }
    }, [settings.activeChannelId, currentUserData?.me?.channels]);

    // Auth actions
    const login = React.useCallback(
        (username: string, password: string, onLoginSuccess?: () => void) => {
            setIsLoginLogoutInProgress(true);
            setStatus('verifying');
            api.mutate(LoginMutation)({ username, password })
                .then(async data => {
                    if (data.login.__typename === 'CurrentUser') {
                        setAuthenticationError(undefined);
                        const { data: refetchedData } = await refetchCurrentUser();
                        // Synchronously set the channel token in localStorage before
                        // invalidating queries. This is critical for non-superadmin users
                        // whose roles are scoped only to non-default channels. Without this,
                        // the invalidateQueries() call below triggers the activeChannel and
                        // channels queries before React effects in ChannelProvider have a
                        // chance to write the token to localStorage. When no vendure-token
                        // header is present, the backend defaults to the default channel,
                        // and the user gets FORBIDDEN because they have no permissions on it.
                        if (refetchedData?.me?.channels?.length) {
                            const previousChannel = settings.activeChannelId
                                ? refetchedData.me.channels.find(c => c.id === settings.activeChannelId)
                                : undefined;
                            const channel = previousChannel ?? refetchedData.me.channels[0];
                            try {
                                localStorage.setItem(LS_KEY_SELECTED_CHANNEL_TOKEN, channel.token);
                            } catch (e) {
                                console.error('Failed to store selected channel in localStorage', e);
                            }
                            setActiveChannelId(channel.id);
                        }
                        // Invalidate all queries to ensure fresh data after login
                        await queryClient.invalidateQueries();
                        setStatus('authenticated');
                        setIsLoginLogoutInProgress(false);
                        onLoginSuccess?.();
                    } else {
                        setAuthenticationError(data?.login.message);
                        setStatus('unauthenticated');
                        setIsLoginLogoutInProgress(false);
                    }
                })
                .catch(error => {
                    setAuthenticationError(error.message);
                    setStatus('unauthenticated');
                    setIsLoginLogoutInProgress(false);
                });
        },
        [refetchCurrentUser, queryClient, settings.activeChannelId, setActiveChannelId],
    );

    const logout = React.useCallback(
        async (onLogoutSuccess?: () => void) => {
            setIsLoginLogoutInProgress(true);
            setStatus('verifying');
            api.mutate(LogOutMutation)({}).then(async data => {
                if (data?.logout.success) {
                    // Clear all cached queries to prevent stale data
                    queryClient.clear();
                    // Clear selected channel from localStorage
                    localStorage.removeItem(LS_KEY_SELECTED_CHANNEL_TOKEN);
                    setStatus('unauthenticated');
                    setIsLoginLogoutInProgress(false);
                    onLogoutSuccess?.();
                }
            });
        },
        [queryClient],
    );

    // Determine isAuthenticated from currentUserData
    const isAuthenticated = !!currentUserData?.me?.id;

    // Handle status transitions based on query state
    React.useEffect(() => {
        // Don't change status if we're in the middle of login/logout
        if (isLoginLogoutInProgress) {
            return;
        }

        // If query is loading and we haven't started verifying yet, set to verifying
        if (isLoading && status === 'initial') {
            setStatus('verifying');
            return;
        }

        // If query has completed (not loading) and we're in verifying state, determine final status
        if (!isLoading && status === 'verifying') {
            if (currentUserError || !currentUserData?.me?.id) {
                setStatus('unauthenticated');
            } else {
                setStatus('authenticated');
            }
        }
    }, [isLoading, currentUserData, currentUserError, status, isLoginLogoutInProgress]);

    const refreshCurrentUser = () => {
        queryClient.invalidateQueries({
            queryKey: ['currentUser'],
        });
    };

    return (
        <AuthContext.Provider
            value={{
                isAuthenticated,
                authenticationError,
                status,
                user: currentUserData?.activeAdministrator,
                channels: currentUserData?.me?.channels,
                login,
                logout,
                refreshCurrentUser,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}
