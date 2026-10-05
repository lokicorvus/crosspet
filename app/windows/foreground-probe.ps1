# Only used by --smoke-test; creates a harmless window to verify foreground following.
param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -OutputAssembly $Output -OutputType WindowsApplication -TypeDefinition @'
using System;
using System.Windows.Forms;
public class CrossPetProbe {
    [STAThread] public static void Main() {
        var window = new Form { Text = "CrossPet foreground test", Width = 320, Height = 180, TopMost = true };
        window.Shown += (s, e) => window.Activate();
        Application.Run(window);
    }
}
'@
