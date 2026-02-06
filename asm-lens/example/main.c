#include <stdio.h>

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

int main(void) {
    int result = sum_squares(10);
    printf("Sum of squares 1..10 = %d\n", result);
    return 0;
}
