// Shared confirm copy for the user actions on /users and /users/[id].

// PATCH /admin/users/:id/deactivate only expires the subscription and
// deactivates push devices. It does not block sign-in.
export const END_SUBSCRIPTION_CONFIRM_MESSAGE =
    "This sets the user's subscription to EXPIRED and turns off push notifications for all of their devices.\n\n" +
    "It does NOT block the account: the user can still sign in and use the free tier.";

// DELETE /admin/users/:id does a full cleanup.
export const DELETE_USER_CONFIRM_MESSAGE =
    "This removes the account, its cloned voices at the provider, stored files and the Firebase login. This cannot be undone.";
