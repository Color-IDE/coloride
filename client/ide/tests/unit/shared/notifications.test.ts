import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { dismissAllNotifications, dismissNotification, getNotifications, notify, subscribeNotifications } from "../../../src/shared/ui/notifications";

afterEach(dismissAllNotifications);

test("updating a notification keeps its place and replaces its action and lifetime", () => {
  const first = notify({ id: "save", title: "Saving", duration: 0, action: { label: "Cancel", onClick() {} } });
  notify({ title: "Another task" });
  const snapshot = getNotifications();
  notify({ id: first, title: "Saved", kind: "success", duration: 1000 });
  assert.equal(snapshot[0].title, "Saving");
  assert.equal(getNotifications().length, 2);
  assert.equal(getNotifications()[0].title, "Saved");
  assert.equal(getNotifications()[0].duration, 1000);
  assert.equal(getNotifications()[0].action, undefined);
  assert.notEqual(getNotifications()[0].revision, snapshot[0].revision);
});

test("errors and actions stay available until dismissed; informational notices expire", () => {
  notify({ title: "Failure", kind: "error" });
  notify({ title: "Retry", action: { label: "Retry", onClick() {} } });
  notify({ title: "Saved", kind: "success" });
  assert.deepEqual(getNotifications().map(item => item.duration), [0, 0, 5000]);
});

test("dismissing a missing id is a no-op and subscribers can unsubscribe", () => {
  let updates = 0;
  const unsubscribe = subscribeNotifications(() => updates++);
  const id = notify({ title: "Ready" });
  dismissNotification("missing");
  assert.equal(updates, 1);
  unsubscribe();
  dismissNotification(id);
  assert.equal(updates, 1);
  assert.equal(getNotifications().length, 0);
});
