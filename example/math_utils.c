#include "math_utils.h"

int square(int x) {
    return x * x;
}

int sum_squares(int n) {
    int total = 0;
    for (int i = 1; i <= n; i++) {
        total += square(i);
    }
    return total;
}
