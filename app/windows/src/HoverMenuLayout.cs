using System;
using System.Drawing;

namespace CrossPet
{
    static class HoverMenuLayout
    {
        public const int DefaultDelay = 3000;

        public static int Delay(object value)
        {
            if (!(value is int || value is long || value is double || value is decimal)) return DefaultDelay;
            var number = Convert.ToDouble(value);
            if (double.IsNaN(number) || double.IsInfinity(number)) return DefaultDelay;
            return (int)(Math.Round(Math.Max(1000, Math.Min(10000, number)) / 500,
                                   MidpointRounding.AwayFromZero) * 500);
        }

        public static Rectangle Place(Rectangle pet, Rectangle work, int width, int height)
        {
            width = Math.Max(1, Math.Min(width, work.Width));
            height = Math.Max(1, Math.Min(height, work.Height));
            var right = pet.Left + (int)(pet.Width * .78);
            var left = pet.Left - width + (int)(pet.Width * .22);
            var x = right + width <= work.Right ? right : left;
            x = Math.Max(work.Left, Math.Min(x, work.Right - width));
            var y = pet.Top + (int)(pet.Height * .22);
            y = Math.Max(work.Top, Math.Min(y, work.Bottom - height));
            return new Rectangle(x, y, width, height);
        }
    }
}
