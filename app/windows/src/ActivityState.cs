using System;
using System.Collections.Generic;
using System.Linq;

namespace CrossPet
{
    // Keep the same timeout as the renderer; a missing Stop must not leave a pet working forever.
    sealed class ActivityState
    {
        public const double TimeoutSeconds = 600;
        public readonly Dictionary<string, Dictionary<string, object>> States = new Dictionary<string, Dictionary<string, object>>();
        public readonly Dictionary<string, Dictionary<string, object>> Sessions = new Dictionary<string, Dictionary<string, object>>();
        static readonly HashSet<string> TerminalEvents = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        { "Stop", "SessionEnd", "Interrupt", "TurnAborted", "AfterAgent" };
        static readonly HashSet<string> WorkingPoses = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        { "listening", "thinking", "reading", "writing", "running", "searching", "delegating", "compact", "deepthink", "drawing", "asking" };

        public static double Timestamp(Dictionary<string, object> state)
        {
            try { return state.TryGetValue("ts", out var ts) ? Convert.ToDouble(ts) : 0; }
            catch { return 0; }
        }

        public static bool Fresh(Dictionary<string, object> state, double now)
        {
            var age = now - Timestamp(state);
            return age >= -30 && age < TimeoutSeconds;
        }

        public static bool Working(Dictionary<string, object> state, double now)
        {
            if (!Fresh(state, now)) return false;
            var ev = state.TryGetValue("event", out var e) ? e as string : null;
            if (ev != null && TerminalEvents.Contains(ev)) return false;
            var pose = state.TryGetValue("pose", out var p) ? p as string : null;
            // A tool failure can be followed by another tool or inference in the same turn.
            return pose != null && (WorkingPoses.Contains(pose) || (pose == "oops" && (ev == "PostToolUse" || ev == "AfterTool" || ev == "PostToolUseFailure")));
        }

        // A finished conversation must not hide another conversation of the same model.
        public Dictionary<string, object> Effective(string id, double now)
        {
            var candidates = new List<Dictionary<string, object>>();
            if (States.TryGetValue(id, out var state)) candidates.Add(state);
            if (Sessions.TryGetValue(id, out var sessions)) candidates.AddRange(sessions.Values.OfType<Dictionary<string, object>>());
            return candidates.Where(s => Working(s, now)).OrderByDescending(Timestamp).FirstOrDefault();
        }

        public List<string> Active(double now) => States.Keys.Union(Sessions.Keys).Where(id => Effective(id, now) != null)
            .OrderBy(id => id, StringComparer.Ordinal).ToList();
    }
}
